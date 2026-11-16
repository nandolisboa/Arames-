import type { RealtimeChannel, Session, User } from '@supabase/supabase-js';
import { ClipboardList, Disc, Moon, Sun, Target } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ARAMES_LOGO_DATA_URL } from './assets/logo';
import { CoilsPanel } from './components/CoilsPanel';
import { GoalProgress } from './components/GoalProgress';
import { LoginScreen } from './components/LoginScreen';
import { ProductionPanel } from './components/ProductionPanel';
import {
  DEFAULT_GOALS,
  MESSAGES,
  OPERATORS,
  fmtDate,
  rowDate,
} from './constants';
import { supabase } from './lib/supabase';
import type {
  AppProfile,
  AppTab,
  CoilRow,
  GoalTargets,
  OperatorName,
  ProductionRow,
} from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<AppTab>('production');
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('arames_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [allRows, setAllRows] = useState<ProductionRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [goalTargets, setGoalTargets] = useState<GoalTargets>({
    ...DEFAULT_GOALS,
  });

  const [coilRows, setCoilRows] = useState<CoilRow[]>([]);
  const [coilsLoaded, setCoilsLoaded] = useState(false);
  const [coilsLoading, setCoilsLoading] = useState(false);
  const [coilsError, setCoilsError] = useState('');
  const coilsLoadedAtRef = useRef<number>(0);
  const coilsLoadedRef = useRef<boolean>(false);

  const [onlineOperators, setOnlineOperators] = useState<Set<string>>(
    () => new Set()
  );

  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userRef = useRef<User | null>(null);
  const profileRef = useRef<AppProfile | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  userRef.current = user;
  profileRef.current = profile;
  coilsLoadedRef.current = coilsLoaded;

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const isAdmin = profile?.role === 'master';
  const readAll =
    profile?.role === 'master' || profile?.role === 'administration';
  const canSeeCoils = readAll;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('arames_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
    }, 2600);
  }, []);

  const stopProductionRealtime = useCallback(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    if (realtimeChannelRef.current) {
      const ch = realtimeChannelRef.current;
      realtimeChannelRef.current = null;
      supabase.removeChannel(ch).catch(() => {});
    }
  }, []);

  const stopPresence = useCallback(() => {
    if (presenceChannelRef.current) {
      const ch = presenceChannelRef.current;
      presenceChannelRef.current = null;
      supabase.removeChannel(ch).catch(() => {});
    }
    setOnlineOperators(new Set());
  }, []);

  const loadGoals = useCallback(async (activeProfile: AppProfile) => {
    if (!activeProfile) return;
    const { data, error } = await supabase
      .from('monthly_goals')
      .select('operator,target');
    if (error) {
      console.warn('Monthly goal settings unavailable', error);
      setGoalTargets({ ...DEFAULT_GOALS });
      return;
    }
    const nextGoals: GoalTargets = { ...DEFAULT_GOALS };
    for (const row of data || []) {
      if (
        OPERATORS.includes(row.operator as OperatorName) &&
        Number.isSafeInteger(Number(row.target)) &&
        Number(row.target) > 0
      ) {
        nextGoals[row.operator as OperatorName] = Number(row.target);
      }
    }
    setGoalTargets(nextGoals);
  }, []);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const batchSize = 500;
      let offset = 0;
      const records: ProductionRow[] = [];

      const countResult = await supabase
        .from('productions')
        .select('id', { count: 'exact', head: true });
      if (countResult.error) throw countResult.error;

      const totalVisible = countResult.count || 0;
      while (offset < totalVisible) {
        const { data, error } = await supabase
          .from('productions')
          .select(
            'id,production_date,operator,gauge,measure,package_type,pieces_per_unit,units,total_pieces,created_at'
          )
          .order('production_date', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, Math.min(offset + batchSize, totalVisible) - 1);

        if (error) throw error;
        if (!data?.length) {
          throw new Error(
            'A paginação das produções parou antes do fim. Tente atualizar a tela.'
          );
        }
        records.push(...(data as ProductionRow[]));
        offset += data.length;
      }

      setAllRows(
        records.map((r) => ({
          ...r,
          production_date: rowDate(r.production_date),
        }))
      );
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const loadCoils = useCallback(async (force = false) => {
    const activeProfile = profileRef.current;
    const allowed =
      activeProfile?.role === 'master' ||
      activeProfile?.role === 'administration';
    if (!allowed) return;
    if (
      !force &&
      coilsLoadedRef.current &&
      Date.now() - coilsLoadedAtRef.current < 30000
    ) {
      return;
    }

    coilsLoadedRef.current = false;
    setCoilsLoaded(false);
    setCoilsLoading(true);
    setCoilsError('');

    try {
      const { data, error } = await supabase
        .from('coils')
        .select(
          'id,gauge,manufacturer,weight_kg,weight_label_kg,weight_scale_kg,weight_source,invoice_number,invoice_series,created_at'
        )
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCoilRows((data as CoilRow[]) || []);
      coilsLoadedRef.current = true;
      setCoilsLoaded(true);
      coilsLoadedAtRef.current = Date.now();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'erro de conexão';
      setCoilsError(`Não foi possível carregar as bobinas: ${msg}`);
    } finally {
      setCoilsLoading(false);
    }
  }, []);

  const startProductionRealtime = useCallback(() => {
    if (!userRef.current) return;
    stopProductionRealtime();

    const channel = supabase
      .channel('production-records-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productions' },
        () => {
          if (!userRef.current) return;
          if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
          reloadTimerRef.current = setTimeout(() => {
            loadRows().catch((e) => {
              notify(
                e instanceof Error
                  ? e.message
                  : 'Não foi possível atualizar as produções.'
              );
            });
          }, 250);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(
            'Production Realtime unavailable; enable public.productions in the Supabase Realtime publication.'
          );
        }
      });

    realtimeChannelRef.current = channel;
  }, [loadRows, notify, stopProductionRealtime]);

  const startPresence = useCallback(
    (activeUser: User, activeProfile: AppProfile) => {
      stopPresence();
      const presenceSessionId = `${activeUser.id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      const channel = supabase.channel('production-operators-presence', {
        config: { presence: { key: presenceSessionId } },
      });

      channel.on('presence', { event: 'sync' }, () => {
        if (!presenceChannelRef.current) return;
        const state = presenceChannelRef.current.presenceState<{
          display_name?: string;
        }>();
        const next = new Set<string>();
        for (const metas of Object.values(state)) {
          for (const meta of metas || []) {
            if (
              meta?.display_name &&
              OPERATORS.includes(meta.display_name as OperatorName)
            ) {
              next.add(meta.display_name);
            }
          }
        }
        setOnlineOperators(next);
      });

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              display_name: activeProfile.display_name,
              online_at: new Date().toISOString(),
            });
          } catch (e) {
            console.warn('Presence unavailable', e);
          }
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setOnlineOperators((prev) => {
            const next = new Set(prev);
            next.delete(activeProfile.display_name);
            return next;
          });
        }
      });

      presenceChannelRef.current = channel;
    },
    [stopPresence]
  );

  const enterSession = useCallback(
    async (session: Session) => {
      const sessionUser = session.user;
      const { data, error } = await supabase
        .from('app_profiles')
        .select('display_name,role')
        .eq('user_id', sessionUser.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        await supabase.auth.signOut();
        throw new Error(MESSAGES.profileMissing);
      }

      const displayName = String(data.display_name || '').trim();
      const role = String(data.role || '').trim();
      const isAdministrationProfile =
        role === 'administration' && displayName === 'Administração';

      if (
        (!OPERATORS.includes(displayName as OperatorName) &&
          !isAdministrationProfile) ||
        !role ||
        role.length > 40
      ) {
        await supabase.auth.signOut();
        throw new Error(MESSAGES.profileInvalid);
      }

      const resolvedProfile: AppProfile = {
        display_name: displayName,
        role,
      };

      userRef.current = sessionUser;
      profileRef.current = resolvedProfile;
      try {
        if (
          sessionUser.email &&
          localStorage.getItem('arames_remember_user') !== '0'
        ) {
          localStorage.setItem('arames_remembered_email', sessionUser.email);
        }
      } catch {
        // ignore storage errors
      }
      setUser(sessionUser);
      setProfile(resolvedProfile);
      setActiveTab('production');

      await loadGoals(resolvedProfile);
      await loadRows();

      startPresence(sessionUser, resolvedProfile);
      startProductionRealtime();
    },
    [loadGoals, loadRows, startPresence, startProductionRealtime]
  );

  useEffect(() => {
    let active = true;

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && userRef.current) {
        setTimeout(() => {
          if (!userRef.current || !active) return;
          userRef.current = null;
          profileRef.current = null;
          setUser(null);
          setProfile(null);
          stopPresence();
          stopProductionRealtime();
          setAllRows([]);
          setCoilRows([]);
          coilsLoadedRef.current = false;
          setCoilsLoaded(false);
          coilsLoadedAtRef.current = 0;
        }, 0);
      }
    });

    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (data.session && active) {
          try {
            await enterSession(data.session);
          } catch (e) {
            if (!active) return;
            setUser(null);
            setProfile(null);
            setLoginError(
              e instanceof Error
                ? e.message
                : 'Não foi possível carregar o perfil.'
            );
          }
        }
      })
      .catch((e) => {
        if (!active) return;
        setUser(null);
        setProfile(null);
        setLoginError(
          e instanceof Error ? e.message : 'Erro de conexão'
        );
      });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      stopPresence();
      stopProductionRealtime();
    };
  }, [enterSession, stopPresence, stopProductionRealtime]);

  const handleLogin = async (
    emailRaw: string,
    password: string,
    rememberUser: boolean
  ) => {
    setLoginError('');
    const email = emailRaw.trim();
    if (!email || !password) {
      setLoginError('Informe o e-mail e a senha.');
      return;
    }

    setLoginBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      if (!data.session) {
        throw new Error('Sessão não retornada.');
      }
      await enterSession(data.session);
      try {
        localStorage.setItem('arames_remember_user', rememberUser ? '1' : '0');
        if (rememberUser) {
          localStorage.setItem('arames_remembered_email', email);
        } else {
          localStorage.removeItem('arames_remembered_email');
        }
      } catch {
        // ignore storage errors
      }
    } catch (e) {
      setUser(null);
      setProfile(null);
      setLoginError(
        e instanceof Error
          ? e.message
          : 'Não foi possível entrar. Confira o e-mail e a senha.'
      );
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    stopPresence();
    stopProductionRealtime();
    await supabase.auth.signOut();
    userRef.current = null;
    profileRef.current = null;
    setUser(null);
    setProfile(null);
    setAllRows([]);
    setCoilRows([]);
    coilsLoadedRef.current = false;
    setCoilsLoaded(false);
    coilsLoadedAtRef.current = 0;
    setActiveTab('production');
    setGoalsOpen(false);
    setLoginError('');
  };

  const handleSaveGoal = async (op: OperatorName, target: number) => {
    if (!isAdmin || !OPERATORS.includes(op) || !user) return;
    if (!Number.isSafeInteger(target) || target < 1 || target > 100000000) {
      notify('Informe uma meta inteira entre 1 e 100.000.000 peças.');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('monthly_goals')
        .upsert(
          { operator: op, target, updated_by: user.id },
          { onConflict: 'operator' }
        )
        .select('operator,target');

      if (error) throw error;
      if (!data?.length) {
        throw new Error('O banco não confirmou a meta.');
      }
      setGoalTargets((prev) => ({ ...prev, [op]: target }));
      notify(`Meta de ${op} salva`);
    } catch (e) {
      console.error(e);
      notify(
        e instanceof Error
          ? e.message
          : 'Não foi possível salvar a meta. Confira a tabela monthly_goals.'
      );
    }
  };

  const handleSaveProduction = async ({
    editingId,
    production_date,
    operator,
    gauge,
    measure,
    package_type,
    pieces_per_unit,
    units,
  }: {
    editingId: string | number | null;
    production_date: string;
    operator: OperatorName;
    gauge: string;
    measure: string;
    package_type: string;
    pieces_per_unit: number;
    units: number;
  }): Promise<{ ok: boolean; savedId?: string | number }> => {
    if (!profile || profile.role === 'administration' || !user) {
      return { ok: false };
    }

    const payload = {
      production_date,
      operator,
      gauge,
      measure,
      package_type,
      pieces_per_unit,
      units,
    };

    try {
      let result;
      if (editingId !== null) {
        if (!isAdmin) {
          throw new Error('Somente Fernando pode alterar registros.');
        }
        result = await supabase
          .from('productions')
          .update(payload)
          .eq('id', editingId)
          .select('id,production_date');
      } else {
        result = await supabase
          .from('productions')
          .insert({ ...payload, created_by: user.id })
          .select('id,production_date');
      }

      if (result.error) throw result.error;
      if (!result.data?.length) {
        throw new Error(
          'O banco não confirmou a gravação. Confira as políticas de acesso.'
        );
      }

      const returnedDate = result.data[0].production_date;
      if (returnedDate && rowDate(returnedDate) !== production_date) {
        throw new Error(
          `O banco devolveu a data ${fmtDate(
            rowDate(returnedDate)
          )} em vez de ${fmtDate(
            production_date
          )}. A produção não foi confirmada com a data escolhida.`
        );
      }

      await loadRows();
      notify(
        editingId !== null
          ? 'Alterações salvas'
          : `Produção de ${fmtDate(production_date)} salva`
      );
      return { ok: true, savedId: result.data[0].id };
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível salvar');
      return { ok: false };
    }
  };

  const handleDeleteProduction = async (id: string | number) => {
    if (!isAdmin) return;
    try {
      const { data, error } = await supabase
        .from('productions')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error('O banco não confirmou a exclusão.');
      }
      await loadRows();
      notify('Registro apagado');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível apagar');
    }
  };

  const handleSaveCoil = async (payload: {
    gauge: string;
    manufacturer: string;
    weight_kg: number;
    weight_label_kg: number | null;
    weight_scale_kg: number | null;
    weight_source: string;
    invoice_number: string;
    invoice_series: string | null;
  }): Promise<boolean> => {
    if (!isAdmin || !user) return false;
    try {
      const { data, error } = await supabase
        .from('coils')
        .insert({ ...payload, created_by: user.id })
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error('O banco não confirmou o cadastro.');
      }
      notify('Bobina cadastrada');
      coilsLoadedRef.current = false;
      setCoilsLoaded(false);
      await loadCoils(true);
      return true;
    } catch (e) {
      notify(
        e instanceof Error ? e.message : 'Não foi possível cadastrar a bobina'
      );
      return false;
    }
  };

  const handleDeleteCoil = async (id: string | number) => {
    if (!isAdmin) return;
    try {
      const { data, error } = await supabase
        .from('coils')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error('O banco não confirmou a exclusão.');
      }
      notify('Bobina apagada');
      coilsLoadedRef.current = false;
      setCoilsLoaded(false);
      await loadCoils(true);
    } catch (e) {
      notify(
        e instanceof Error ? e.message : 'Não foi possível apagar a bobina'
      );
    }
  };

  const handleTabSwitch = (tab: AppTab) => {
    const next = tab === 'coils' && canSeeCoils ? 'coils' : 'production';
    setActiveTab(next);
    if (next === 'coils') {
      void loadCoils();
    }
  };

  return (
    <>
      {!profile ? (
        <LoginScreen
          busy={loginBusy}
          error={loginError}
          onLogin={handleLogin}
        />
      ) : (
        <div className="wrap" id="app">
          <header className="top">
            <div className="brand">
              <img
                alt="Arames Brasil"
                className="brand-logo"
                src={ARAMES_LOGO_DATA_URL}
              />
            </div>

            <nav aria-label="Navegação principal" className="app-tabs" id="appTabs">
              <button
                className={`app-tab${activeTab === 'production' && !goalsOpen ? ' active' : ''}`}
                id="productionTab"
                type="button"
                onClick={() => handleTabSwitch('production')}
              >
                <ClipboardList aria-hidden="true" className="app-tab-icon" size={18} />
                <span>Produção</span>
              </button>
              {canSeeCoils && (
                <button
                  className={`app-tab${activeTab === 'coils' && !goalsOpen ? ' active' : ''}`}
                  id="coilsTab"
                  type="button"
                  onClick={() => handleTabSwitch('coils')}
                >
                  <Disc aria-hidden="true" className="app-tab-icon" size={18} />
                  <span>Bobinas</span>
                </button>
              )}
              <button
                className={`app-tab${goalsOpen ? ' active' : ''}`}
                id="goalsTab"
                type="button"
                onClick={() => setGoalsOpen(true)}
              >
                <Target aria-hidden="true" className="app-tab-icon" size={18} />
                <span>METAS</span>
              </button>
            </nav>

            <div className="who">
              <button
                aria-label={
                  theme === 'dark'
                    ? 'Mudar para modo claro'
                    : 'Mudar para modo escuro'
                }
                className="btn secondary small theme-toggle-btn"
                id="themeToggleBtn"
                title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
                type="button"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? (
                  <>
                    <Sun aria-hidden="true" size={15} />
                    <span className="theme-toggle-text">Claro</span>
                  </>
                ) : (
                  <>
                    <Moon aria-hidden="true" size={15} />
                    <span className="theme-toggle-text">Escuro</span>
                  </>
                )}
              </button>
              <button
                className="btn secondary small"
                id="logoutBtn"
                type="button"
                onClick={() => void handleLogout()}
              >
                Sair
              </button>
            </div>
          </header>

          <GoalProgress
            allRows={allRows}
            goalTargets={goalTargets}
            isAdmin={isAdmin}
            open={goalsOpen}
            profile={profile}
            readAll={readAll}
            onClose={() => setGoalsOpen(false)}
            onSaveGoal={handleSaveGoal}
          />

          <CoilsPanel
            canSeeCoils={canSeeCoils}
            coilRows={coilRows}
            coilsError={coilsError}
            coilsLoaded={coilsLoaded}
            coilsLoading={coilsLoading}
            isAdmin={isAdmin}
            visible={activeTab === 'coils' && canSeeCoils}
            onDeleteCoil={handleDeleteCoil}
            onNotify={notify}
            onSaveCoil={handleSaveCoil}
          />

          <ProductionPanel
            allRows={allRows}
            isAdmin={isAdmin}
            loadingRows={loadingRows}
            onlineOperators={onlineOperators}
            profile={profile}
            readAll={readAll}
            visible={activeTab === 'production'}
            onDeleteProduction={handleDeleteProduction}
            onNotify={notify}
            onSaveProduction={handleSaveProduction}
          />
        </div>
      )}

      <div className={`toast${toastMsg ? '' : ' hidden'}`} id="toast">
        {toastMsg}
      </div>
      <div id="printArea" />
    </>
  );
}
