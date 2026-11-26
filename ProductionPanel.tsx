import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GAUGES,
  KINDS,
  MESSAGES,
  OPERATORS,
  PAGE_SIZE,
  fmtDate,
  gaugeTextClass,
  gaugeValueForDigit,
  rowDate,
  today,
  validDate,
} from '../constants';
import {
  createProductionPdfPreview,
  type PdfPreviewData,
} from '../lib/reports';
import type {
  AppProfile,
  OperatorName,
  ProductionRow,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { PdfPreviewDialog } from './PdfPreviewDialog';

type FormFieldId =
  | 'date'
  | 'operator'
  | 'kind'
  | 'measure'
  | 'gauge'
  | 'pieces'
  | 'units';

interface ProductionPanelProps {
  visible: boolean;
  profile: AppProfile | null;
  isAdmin: boolean;
  readAll: boolean;
  loadingRows: boolean;
  loadError: string;
  onRetryLoad: () => void;
  allRows: ProductionRow[];
  onlineOperators: Set<string>;
  onSaveProduction: (params: {
    editingId: string | number | null;
    production_date: string;
    operator: OperatorName;
    gauge: string;
    measure: string;
    package_type: string;
    pieces_per_unit: number;
    units: number;
  }) => Promise<{ ok: boolean; savedId?: string | number }>;
  onDeleteProduction: (id: string | number) => Promise<void>;
  onNotify: (msg: string) => void;
}

export function ProductionPanel({
  visible,
  profile,
  isAdmin,
  readAll,
  loadingRows,
  loadError,
  onRetryLoad,
  allRows,
  onlineOperators,
  onSaveProduction,
  onDeleteProduction,
  onNotify,
}: ProductionPanelProps) {
  const [date, setDate] = useState(today);
  const [operator, setOperator] = useState<OperatorName>('Fernando');
  const [kind, setKind] = useState<string>('PACOTE');
  const [measure, setMeasure] = useState('');
  const [gauge, setGauge] = useState<string>('3,8');
  const [pieces, setPieces] = useState('');
  const [units, setUnits] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [saving, setSaving] = useState(false);
  const [mobileView, setMobileView] = useState<'form' | 'list'>('form');

  const [productionSearch, setProductionSearch] = useState('');
  const [pages, setPages] = useState<Record<string, number>>({});
  const [expandedOperators, setExpandedOperators] = useState<
    Record<string, boolean>
  >({});
  const [searchExpandedOperators, setSearchExpandedOperators] = useState<
    Record<string, boolean>
  >({});
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<FormFieldId, string>>
  >({});

  const [debouncedMeasureQuery, setDebouncedMeasureQuery] = useState('');
  const [showMeasureSuggestions, setShowMeasureSuggestions] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewData | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] =
    useState<ProductionRow | null>(null);

  const dateRef = useRef<HTMLInputElement>(null);
  const operatorRef = useRef<HTMLSelectElement>(null);
  const kindRef = useRef<HTMLButtonElement>(null);
  const beforeSpecialKindRef = useRef<{ gauge: string; pieces: string } | null>(null);
  const measureRef = useRef<HTMLInputElement>(null);
  const gaugeRef = useRef<HTMLButtonElement>(null);
  const piecesRef = useRef<HTMLInputElement>(null);
  const unitsRef = useRef<HTMLInputElement>(null);
  const measureSuggestionsRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const summaryDialogRef = useRef<HTMLDialogElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (profile && !isAdmin && OPERATORS.includes(profile.display_name as OperatorName)) {
      setOperator(profile.display_name as OperatorName);
    }
  }, [profile, isAdmin]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedMeasureQuery(measure.trim().toLocaleLowerCase('pt-BR'));
    }, 120);
    return () => clearTimeout(timer);
  }, [measure]);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        measureSuggestionsRef.current &&
        !measureSuggestionsRef.current.contains(target) &&
        target !== measureRef.current
      ) {
        setShowMeasureSuggestions(false);
      }
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  useEffect(() => {
    const dlg = confirmDialogRef.current;
    if (!dlg) return;
    if (confirmModalOpen && !dlg.open) {
      dlg.showModal();
      confirmBtnRef.current?.focus();
    } else if (!confirmModalOpen && dlg.open) {
      dlg.close();
    }
  }, [confirmModalOpen]);

  useEffect(() => {
    const dialog = summaryDialogRef.current;
    if (!dialog) return;
    if (summaryOpen && !dialog.open) dialog.showModal();
    else if (!summaryOpen && dialog.open) dialog.close();
  }, [summaryOpen]);

  const totalAllPieces = useMemo(
    () => allRows.reduce((sum, row) => sum + (Number(row.total_pieces) || 0), 0),
    [allRows]
  );

  const measureSuggestions = useMemo(() => {
    if (debouncedMeasureQuery.length < 1) return [];
    const values = Array.from(
      new Set(allRows.map((r) => String(r.measure || '').trim()).filter(Boolean))
    )
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .filter((val) =>
        val.toLocaleLowerCase('pt-BR').includes(debouncedMeasureQuery)
      );
    return values.slice(0, 6);
  }, [allRows, debouncedMeasureQuery]);

  const filteredRows = useMemo(() => {
    const tokens = productionSearch
      .trim()
      .toLocaleLowerCase('pt-BR')
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return allRows;

    return allRows.filter((r) => {
      const rawDate = rowDate(r.production_date);
      const formattedDate = fmtDate(rawDate);
      const piecesRaw = String(r.pieces_per_unit);
      const piecesFmt = Number(r.pieces_per_unit).toLocaleString('pt-BR');
      const unitsRaw = String(r.units);
      const unitsFmt = Number(r.units).toLocaleString('pt-BR');
      const totalRaw = String(r.total_pieces);
      const totalFmt = Number(r.total_pieces).toLocaleString('pt-BR');

      const haystack = [
        r.operator,
        formattedDate,
        rawDate,
        r.measure,
        r.gauge,
        `${r.gauge} mm`,
        r.package_type,
        piecesRaw,
        piecesFmt,
        unitsRaw,
        unitsFmt,
        totalRaw,
        totalFmt,
      ]
        .join(' ')
        .toLocaleLowerCase('pt-BR');

      return tokens.every((token) => haystack.includes(token));
    });
  }, [allRows, productionSearch]);

  const computedTotal = useMemo(() => {
    const p = Number(pieces) || 0;
    const u = Number(units) || 0;
    return (p * u).toLocaleString('pt-BR');
  }, [pieces, units]);

  const isAdministration = profile?.role === 'administration';

  const getActiveOperator = (): OperatorName => {
    return isAdmin
      ? operator
      : ((profile?.display_name || 'Fernando') as OperatorName);
  };

  const validateSingleField = (
    id: FormFieldId,
    overrides?: Partial<{
      date: string;
      operator: string;
      kind: string;
      measure: string;
      gauge: string;
      pieces: string;
      units: string;
    }>
  ): string => {
    const curDate = overrides?.date ?? date;
    const curOp = overrides?.operator ?? getActiveOperator();
    const curKind = overrides?.kind ?? kind;
    const curMeasure = overrides?.measure ?? measure;
    const curGauge = overrides?.gauge ?? gauge;
    const curPieces = overrides?.pieces ?? pieces;
    const curUnits = overrides?.units ?? units;

    switch (id) {
      case 'date':
        return validDate(curDate) ? '' : 'Selecione uma data válida.';
      case 'operator':
        return OPERATORS.includes(curOp as OperatorName)
          ? ''
          : 'Selecione um operador válido.';
      case 'measure': {
        const trimmed = curMeasure.trim();
        return trimmed && trimmed.length <= 40 && !/[<>]/.test(curMeasure)
          ? ''
          : 'Informe a medida do estribo.';
      }
      case 'gauge':
        return GAUGES.includes(curGauge as (typeof GAUGES)[number])
          ? ''
          : 'Selecione a bitola.';
      case 'kind':
        return KINDS.includes(curKind as (typeof KINDS)[number])
          ? ''
          : 'Selecione o tipo de pacote.';
      case 'pieces':
        return Number.isSafeInteger(Number(curPieces)) && Number(curPieces) > 0
          ? ''
          : 'Informe a quantidade de peças.';
      case 'units': {
        const p = Number(curPieces);
        const u = Number(curUnits);
        return Number.isSafeInteger(u) &&
          u > 0 &&
          Number.isSafeInteger(p * u) &&
          p * u <= 2147483647
          ? ''
          : 'Informe uma quantidade de pacotes válida.';
      }
    }
  };

  const checkField = (
    id: FormFieldId,
    overrides?: Partial<{
      date: string;
      operator: string;
      kind: string;
      measure: string;
      gauge: string;
      pieces: string;
      units: string;
    }>
  ): boolean => {
    const msg = validateSingleField(id, overrides);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (msg) {
        next[id] = msg;
      } else {
        delete next[id];
      }
      return next;
    });
    return !msg;
  };

  const focusField = (id: FormFieldId) => {
    const map: Record<FormFieldId, React.RefObject<HTMLElement | null>> = {
      date: dateRef,
      operator: operatorRef,
      kind: kindRef,
      measure: measureRef,
      gauge: gaugeRef,
      pieces: piecesRef,
      units: unitsRef,
    };
    map[id]?.current?.focus();
  };

  const activeSequence = (): FormFieldId[] => {
    const fields: FormFieldId[] = [
      'date',
      'operator',
      'kind',
      'measure',
      'gauge',
      'pieces',
      'units',
    ];
    return fields.filter((k) => k !== 'operator' || isAdmin);
  };

  const handleFieldEnter = (
    id: FormFieldId,
    e: React.KeyboardEvent<HTMLElement>
  ) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const seq = activeSequence();
    const idx = seq.indexOf(id);
    if (idx >= 0 && idx < seq.length - 1) {
      focusField(seq[idx + 1]);
    } else if (id === 'units') {
      handleRequestConfirmation();
    }
  };

  const applyKindValue = (nextKind: string) => {
    setKind(nextKind);
    let nextGauge = gauge;
    let nextPieces = pieces;
    const isSpecial = (value: string) => value === 'M.LIVRE' || value === 'CAIXA';
    if (isSpecial(nextKind) && !isSpecial(kind)) {
      beforeSpecialKindRef.current = { gauge, pieces };
    }
    if (nextKind === 'M.LIVRE') {
      nextGauge = '4,2';
      nextPieces = '';
      setGauge('4,2');
      setPieces('');
    } else if (nextKind === 'CAIXA') {
      nextGauge = '4,2';
      nextPieces = '250';
      setGauge('4,2');
      setPieces('250');
    } else if (isSpecial(kind) && beforeSpecialKindRef.current) {
      // Não conservar preenchimentos automáticos apenas por passar pelo tipo especial.
      const before = beforeSpecialKindRef.current;
      if (gauge === '4,2') { nextGauge = before.gauge; setGauge(before.gauge); }
      if (pieces === '' || (kind === 'CAIXA' && pieces === '250')) {
        nextPieces = before.pieces; setPieces(before.pieces);
      }
      beforeSpecialKindRef.current = null;
    }
    checkField('kind', { kind: nextKind, gauge: nextGauge, pieces: nextPieces });
    if (nextKind === 'M.LIVRE' || nextKind === 'CAIXA') {
      checkField('gauge', { gauge: nextGauge });
      if (nextPieces) {
        checkField('pieces', { pieces: nextPieces });
      }
    }
  };

  const resetForm = (
    preserveDate = false,
    operatorToKeep: OperatorName | null = null,
    keepChoices: { gauge: string; kind: string } | null = null
  ) => {
    beforeSpecialKindRef.current = null;
    setEditingId(null);
    setDate((prev) => (preserveDate && validDate(prev) ? prev : today()));
    setGauge((prev) =>
      keepChoices && GAUGES.includes(keepChoices.gauge as (typeof GAUGES)[number])
        ? keepChoices.gauge
        : GAUGES.includes(prev as (typeof GAUGES)[number])
          ? prev
          : '3,8'
    );
    setMeasure('');
    setKind(() =>
      keepChoices && KINDS.includes(keepChoices.kind as (typeof KINDS)[number])
        ? keepChoices.kind
        : 'PACOTE'
    );
    setPieces('');
    setUnits('');
    setFieldErrors({});
    if (isAdmin) {
      setOperator(
        operatorToKeep && OPERATORS.includes(operatorToKeep)
          ? operatorToKeep
          : 'Fernando'
      );
    } else if (profile) {
      setOperator(profile.display_name as OperatorName);
    }
  };

  const beginEdit = (r: ProductionRow) => {
    if (!isAdmin) return;
    beforeSpecialKindRef.current = null;
    setEditingId(r.id);
    setDate(rowDate(r.production_date));
    setOperator(r.operator as OperatorName);
    setGauge(String(r.gauge));
    setMeasure(r.measure || '');
    setKind(String(r.package_type));
    setPieces(String(r.pieces_per_unit));
    setUnits(String(r.units));
    setFieldErrors({});
    setMobileView('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRequestConfirmation = () => {
    const seq = activeSequence();
    const nextErrors: Partial<Record<FormFieldId, string>> = {};
    let firstInvalid: FormFieldId | null = null;

    for (const id of seq) {
      const msg = validateSingleField(id);
      if (msg) {
        nextErrors[id] = msg;
        if (!firstInvalid) firstInvalid = id;
      }
    }
    setFieldErrors(nextErrors);

    if (firstInvalid) {
      focusField(firstInvalid);
      onNotify(MESSAGES.requiredFields);
      return;
    }
    setConfirmModalOpen(true);
  };

  const executeSave = async () => {
    setConfirmModalOpen(false);
    if (!profile || isAdministration) return;

    const p = Number(pieces);
    const u = Number(units);
    const op = getActiveOperator();

    if (
      !Number.isSafeInteger(p) ||
      p < 1 ||
      !Number.isSafeInteger(u) ||
      u < 1 ||
      !Number.isSafeInteger(p * u) ||
      p * u > 2147483647
    ) {
      onNotify(
        'Informe quantidades inteiras válidas (total máximo: 2.147.483.647)'
      );
      return;
    }

    const trimmedMeasure = measure.trim();
    if (
      !validDate(date) ||
      !OPERATORS.includes(op) ||
      !GAUGES.includes(gauge as (typeof GAUGES)[number]) ||
      !trimmedMeasure ||
      trimmedMeasure.length > 40 ||
      /[<>]/.test(trimmedMeasure) ||
      !KINDS.includes(kind as (typeof KINDS)[number])
    ) {
      onNotify('Preencha uma medida válida do estribo');
      return;
    }

    const wasEdit = editingId !== null;
    const savedDate = date;
    const savedChoices = { gauge, kind };
    const currentEditingId = editingId;

    setSaving(true);
    try {
      const res = await onSaveProduction({
        editingId: currentEditingId,
        production_date: date,
        operator: op,
        gauge,
        measure: trimmedMeasure,
        package_type: kind,
        pieces_per_unit: p,
        units: u,
      });

      if (res.ok) {
        resetForm(!wasEdit, op, savedChoices);
        if (wasEdit) {
          setMobileView('list');
        }
        if (!wasEdit && productionSearch) {
          setProductionSearch('');
          setSearchExpandedOperators({});
        }
        if (!wasEdit && res.savedId !== undefined) {
          // Determine page index for the newly created item in the full operator list
          const nextPageRows = [
            {
              id: res.savedId,
              production_date: savedDate,
              operator: op,
              gauge,
              measure: trimmedMeasure,
              package_type: kind,
              pieces_per_unit: p,
              units: u,
              total_pieces: p * u,
              created_at: new Date().toISOString(),
            },
            ...allRows.filter((r) => String(r.id) !== String(res.savedId)),
          ].filter((r) => r.operator === op);
          const idx = nextPageRows.findIndex(
            (r) => String(r.id) === String(res.savedId)
          );
          if (idx >= 0) {
            setPages((prev) => ({
              ...prev,
              [op]: Math.floor(idx / PAGE_SIZE),
            }));
          }
        }
      }
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const opsToRender = readAll
    ? OPERATORS
    : profile?.display_name
      ? [profile.display_name]
      : [];

  return (
    <section
      className={`production-workspace${isAdministration ? ' is-readonly' : ''}`}
      id="productionPanel"
    >
      {!isAdministration && (
        <div
          aria-label="Alternar entre registro e lista de produções"
          className="mobile-view-switch"
          role="tablist"
        >
          <button
            aria-selected={mobileView === 'form'}
            className={`mobile-view-btn${mobileView === 'form' ? ' active' : ''}`}
            role="tab"
            type="button"
            onClick={() => setMobileView('form')}
          >
            {editingId !== null ? 'Alterar' : 'Registrar'}
          </button>
          <button
            aria-selected={mobileView === 'list'}
            className={`mobile-view-btn${mobileView === 'list' ? ' active' : ''}`}
            role="tab"
            type="button"
            onClick={() => setMobileView('list')}
          >
            Produções ({filteredRows.length})
          </button>
        </div>
      )}

      {!isAdministration && (
        <aside
          className={`production-sidebar${mobileView !== 'form' ? ' mobile-pane-hidden' : ''}`}
        >
          <section className="card sidebar-identity-card" id="identityCard">
            <div className="grid">
              <div
                className={`field${fieldErrors.date ? ' is-invalid' : ''}`}
                data-error={fieldErrors.date || undefined}
              >
                <input
                  ref={dateRef}
                  aria-invalid={fieldErrors.date ? 'true' : undefined}
                  aria-label="Data"
                  aria-required="true"
                  id="date"
                  required
                  type="date"
                  value={date}
                  onBlur={() => {
                    if (date) checkField('date');
                  }}
                  onChange={(e) => {
                    setDate(e.target.value);
                    checkField('date', { date: e.target.value });
                  }}
                  onKeyDown={(e) => handleFieldEnter('date', e)}
                />
              </div>

              {isAdmin ? (
                <div
                  className={`field${fieldErrors.operator ? ' is-invalid' : ''}`}
                  data-error={fieldErrors.operator || undefined}
                  id="operatorWrap"
                >
                  <select
                    ref={operatorRef}
                    aria-invalid={fieldErrors.operator ? 'true' : undefined}
                    aria-label="Operador"
                    aria-required="true"
                    id="operator"
                    required
                    value={operator}
                    onBlur={() => {
                      if (operator) checkField('operator');
                    }}
                    onChange={(e) => {
                      const nextOp = e.target.value as OperatorName;
                      setOperator(nextOp);
                      checkField('operator', { operator: nextOp });
                    }}
                    onKeyDown={(e) => handleFieldEnter('operator', e)}
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field" id="operatorStatic">
                  <div className="total" id="operatorName">
                    {profile?.display_name || ''}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="card sidebar-form-card" id="formCard">
            <h2 id="formTitle">
              {editingId !== null ? 'Alterar produção' : 'Registrar produção'}
            </h2>
            <div className="grid">
            <div
              className={`field${fieldErrors.kind ? ' is-invalid' : ''}`}
              data-error={fieldErrors.kind || undefined}
            >
              <button
                ref={kindRef}
                aria-invalid={fieldErrors.kind ? 'true' : undefined}
                aria-label={`Pacote selecionado: ${kind}. Toque para mudar.`}
                aria-required="true"
                className="btn secondary package-kind-toggle"
                id="kind"
                type="button"
                onClick={() => {
                  const currentIndex = KINDS.indexOf(kind as (typeof KINDS)[number]);
                  const nextKind = KINDS[(currentIndex + 1) % KINDS.length];
                  applyKindValue(nextKind);
                }}
              >
                {kind}
              </button>
            </div>

            <div
              className={`field measure-field${fieldErrors.measure ? ' is-invalid' : ''}`}
              data-error={fieldErrors.measure || undefined}
            >
              <input
                ref={measureRef}
                aria-invalid={fieldErrors.measure ? 'true' : undefined}
                aria-label="ESTRIBO"
                aria-required="true"
                autoComplete="off"
                id="measure"
                maxLength={40}
                placeholder="ESTRIBO"
                required
                type="text"
                value={measure}
                onBlur={() => {
                  if (measure) checkField('measure');
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setMeasure(val);
                  setShowMeasureSuggestions(true);
                  checkField('measure', { measure: val });
                }}
                onFocus={() => setShowMeasureSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    const list = measureSuggestionsRef.current;
                    const options = list
                      ? Array.from(
                          list.querySelectorAll<HTMLButtonElement>(
                            'button.autocomplete-option'
                          )
                        )
                      : [];
                    if (options.length) {
                      e.preventDefault();
                      (e.key === 'ArrowDown'
                        ? options[0]
                        : options[options.length - 1]
                      ).focus();
                      return;
                    }
                  }
                  handleFieldEnter('measure', e);
                }}
              />
              <div
                ref={measureSuggestionsRef}
                className={`autocomplete-list${
                  showMeasureSuggestions && measureSuggestions.length > 0
                    ? ''
                    : ' hidden'
                }`}
                id="measureSuggestions"
                role="listbox"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowMeasureSuggestions(false);
                    measureRef.current?.focus();
                    return;
                  }
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  const list = measureSuggestionsRef.current;
                  if (!list) return;
                  const options = Array.from(
                    list.querySelectorAll<HTMLButtonElement>(
                      'button.autocomplete-option'
                    )
                  );
                  if (!options.length) return;
                  e.preventDefault();
                  const idx = options.indexOf(
                    document.activeElement as HTMLButtonElement
                  );
                  const next =
                    (idx +
                      (e.key === 'ArrowDown' ? 1 : -1) +
                      options.length) %
                    options.length;
                  options[next].focus();
                }}
              >
                {measureSuggestions.map((val) => (
                  <button
                    key={val}
                    className="autocomplete-option"
                    role="option"
                    type="button"
                    onClick={() => {
                      setMeasure(val);
                      setShowMeasureSuggestions(false);
                      checkField('measure', { measure: val });
                      measureRef.current?.focus();
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`field${fieldErrors.gauge ? ' is-invalid' : ''}`}
              data-error={fieldErrors.gauge || undefined}
            >
              <button
                ref={gaugeRef}
                aria-invalid={fieldErrors.gauge ? 'true' : undefined}
                aria-label={`Bitola: ${gauge || 'não selecionada'}. Toque para mudar.`}
                aria-required="true"
                className={`btn secondary gauge-toggle ${gaugeTextClass(gauge)}`}
                id="gauge"
                type="button"
                onClick={() => {
                  const currentIndex = GAUGES.indexOf(gauge as (typeof GAUGES)[number]);
                  const nextGauge = GAUGES[(currentIndex + 1) % GAUGES.length];
                  setGauge(nextGauge);
                  checkField('gauge', { gauge: nextGauge });
                }}
              >
                {gauge || 'Bitola'}
              </button>
            </div>

            <div
              className={`field${fieldErrors.pieces ? ' is-invalid' : ''}`}
              data-error={fieldErrors.pieces || undefined}
            >
              <input
                ref={piecesRef}
                aria-invalid={fieldErrors.pieces ? 'true' : undefined}
                aria-label="QUANTIDADE DE ESTRIBOS"
                aria-required="true"
                id="pieces"
                inputMode="numeric"
                min={1}
                placeholder="QTD. ESTRIBOS"
                required
                step={1}
                type="number"
                value={pieces}
                onBlur={() => {
                  if (pieces) checkField('pieces');
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setPieces(val);
                  checkField('pieces', { pieces: val });
                }}
                onKeyDown={(e) => handleFieldEnter('pieces', e)}
              />
            </div>

            <div
              className={`field${fieldErrors.units ? ' is-invalid' : ''}`}
              data-error={fieldErrors.units || undefined}
            >
              <input
                ref={unitsRef}
                aria-invalid={fieldErrors.units ? 'true' : undefined}
                aria-label="QUANTIDADE DE PACOTES"
                aria-required="true"
                id="units"
                inputMode="numeric"
                min={1}
                placeholder="QTD. PACOTES"
                required
                step={1}
                type="number"
                value={units}
                onBlur={() => {
                  if (units) checkField('units');
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setUnits(val);
                  checkField('units', { units: val });
                }}
                onKeyDown={(e) => handleFieldEnter('units', e)}
              />
            </div>

            <div className="field total-field">
              <div aria-label="TOTAL" className="total" id="total">
                <span className="total-label">Total</span>
                <span className="total-value">{computedTotal}</span>
              </div>
            </div>
          </div>

          <div className="actions">
            {editingId !== null && (
              <button
                className="btn secondary"
                id="cancelBtn"
                type="button"
                onClick={() => {
                  resetForm(false);
                  setMobileView('list');
                }}
              >
                Cancelar
              </button>
            )}
            <button
              className="btn"
              disabled={saving}
              id="saveBtn"
              type="button"
              onClick={handleRequestConfirmation}
            >
              {saving
                ? 'Salvando…'
                : editingId !== null
                  ? 'Salvar alterações'
                  : 'Salvar produção'}
            </button>
          </div>
          </section>
        </aside>
      )}

      <section
        className={`card production-records-card${
          !isAdministration && mobileView !== 'list' ? ' mobile-pane-hidden' : ''
        }`}
      >
        <div className="sectionhead">
          <h2 id="panelTitle">
            {readAll ? 'Produção dos 3 operadores' : 'Minha produção'}
          </h2>
          {readAll && (
            <div className="tools">
              <button
                className="btn secondary small"
                id="printBtn"
                type="button"
                onClick={() => {
                  const preview = createProductionPdfPreview(
                    filteredRows,
                    onNotify
                  );
                  if (preview) setPdfPreview(preview);
                }}
              >
                Imprimir
              </button>
            </div>
          )}
        </div>

        {readAll && (
          <>
            <div className="production-grand-total" aria-live="polite">
              <div>
                <span className="production-grand-total-label">Total geral de produção</span>
                <strong>{loadingRows ? 'Carregando…' : loadError ? 'Indisponível' : `${totalAllPieces.toLocaleString('pt-BR')} peças`}</strong>
                <span className="production-grand-total-note">Todas as produções registradas · sem filtro de busca</span>
              </div>
              {isAdministration && (
                <button className="btn secondary small" type="button" disabled={loadingRows || !!loadError} onClick={() => setSummaryOpen(true)}>
                  Ver resumo
                </button>
              )}
            </div>
            <dialog
              ref={summaryDialogRef}
              className="production-summary-dialog"
              aria-labelledby="production-summary-title"
              onClose={() => setSummaryOpen(false)}
            >
              <div className="production-summary-top">
                <div>
                  <span className="production-summary-kicker">ARAMES BRASIL</span>
                  <h2 id="production-summary-title">Resumo da produção</h2>
                  <p>Todas as produções registradas</p>
                </div>
                <button aria-label="Fechar resumo" className="production-summary-close" type="button" onClick={() => setSummaryOpen(false)}>×</button>
              </div>
              <div className="production-summary-highlight">
                <span>Total geral</span>
                <strong>{totalAllPieces.toLocaleString('pt-BR')}</strong>
                <span>peças produzidas</span>
              </div>
              <div className="production-summary-list">
                {OPERATORS.map((op) => (
                  <div key={op} className="production-summary-row">
                    <span>{op}</span>
                    <strong>{allRows.filter((row) => row.operator === op).reduce((sum, row) => sum + (Number(row.total_pieces) || 0), 0).toLocaleString('pt-BR')} peças</strong>
                  </div>
                ))}
              </div>
              <p className="production-summary-footnote">O total inclui todas as produções carregadas, independentemente da busca.</p>
              <button className="btn secondary production-summary-done" type="button" onClick={() => setSummaryOpen(false)}>Fechar</button>
            </dialog>
          </>
        )}

        <div className="field coil-search-field search-input-wrap">
          <Search aria-hidden="true" className="search-icon" size={16} />
          <input
            aria-label="Pesquisar por nome, data, estribo / medida, tipo, pç/unid., unidades ou total pç"
            id="productionSearch"
            maxLength={120}
            placeholder="Buscar: nome, data, estribo, tipo, qtd. ou total"
            type="search"
            value={productionSearch}
            onChange={(e) => {
              setProductionSearch(e.target.value);
              setPages({});
              setSearchExpandedOperators({});
            }}
          />
        </div>

        <div className="groups" id="records">
          {loadingRows ? (
            <div className="empty">Carregando produções…</div>
          ) : loadError ? (
            <div className="empty load-error" role="alert">
              <p>{loadError}</p>
              <button className="btn secondary small" type="button" onClick={onRetryLoad}>Tentar novamente</button>
            </div>
          ) : !allRows.length ? (
            <div className="empty">Nenhuma produção registrada.</div>
          ) : !filteredRows.length ? (
            <div className="empty">
              Nenhuma produção encontrada para essa busca.
            </div>
          ) : (
            opsToRender.map((op) => {
              const list = filteredRows.filter((r) => r.operator === op);
              if (!list.length) return null;
              const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
              const currentPage = Math.min(pages[op] || 0, pageCount - 1);
              const shown = list.slice(
                currentPage * PAGE_SIZE,
                (currentPage + 1) * PAGE_SIZE
              );
              const sum = list.reduce(
                (acc, r) => acc + Number(r.total_pieces),
                0
              );
              const isOnline = onlineOperators.has(op);
              const hasSearch = productionSearch.trim().length > 0;
              const isExpanded = hasSearch
                ? searchExpandedOperators[op] !== false
                : !!expandedOperators[op];

              return (
                <section key={op} className="operator">
                  <button
                    aria-expanded={isExpanded}
                    className="operator-title operator-toggle"
                    type="button"
                    onClick={() => {
                      if (hasSearch) {
                        setSearchExpandedOperators((prev) => ({
                          ...prev,
                          [op]: prev[op] === false,
                        }));
                      } else {
                        setExpandedOperators((prev) => ({
                          ...prev,
                          [op]: !prev[op],
                        }));
                      }
                    }}
                  >
                    <span className="presence-name">
                      <span
                        aria-label={isOnline ? 'Online' : 'Offline'}
                        className={`presence-dot${isOnline ? ' is-online' : ''}`}
                        role="img"
                        title={isOnline ? 'Online' : 'Offline'}
                      />
                      <span className="operator-btn-label">{op}</span>
                      <span aria-hidden="true" className="operator-chevron">
                        {isExpanded ? '▾' : '▸'}
                      </span>
                    </span>
                    <span className="count">
                      {sum.toLocaleString('pt-BR')} peças
                    </span>
                  </button>
                  {isExpanded && (
                    <>
                      <div className="saved-table-wrap">
                        <table className="saved-table">
                          <thead>
                            <tr>
                              <th>DATA</th>
                              <th>ESTRIBO / MEDIDA</th>
                              <th>TIPO</th>
                              <th className="num">PÇ/UNID.</th>
                              <th className="num">UNIDADES</th>
                              <th className="num">TOTAL PÇ</th>
                              {isAdmin && <th />}
                            </tr>
                          </thead>
                          <tbody>
                            {shown.map((r) => (
                              <tr key={r.id}>
                                <td>{fmtDate(rowDate(r.production_date))}</td>
                                <td>
                                  <span className="saved-dimension">
                                    {r.measure || '—'}
                                  </span>
                                  <span
                                    className={`saved-measure ${gaugeTextClass(r.gauge)}`}
                                  >
                                    {r.gauge} mm
                                  </span>
                                </td>
                                <td>{r.package_type}</td>
                                <td className="num">
                                  {Number(r.pieces_per_unit).toLocaleString(
                                    'pt-BR'
                                  )}
                                </td>
                                <td className="num">
                                  {Number(r.units).toLocaleString('pt-BR')}
                                </td>
                                <td className="num total-cell">
                                  {Number(r.total_pieces).toLocaleString(
                                    'pt-BR'
                                  )}
                                </td>
                                {isAdmin && (
                                  <td className="saved-actions">
                                    <button
                                      className="btn secondary small"
                                      type="button"
                                      onClick={() => beginEdit(r)}
                                    >
                                      Alterar
                                    </button>
                                    <button
                                      className="btn danger small"
                                      type="button"
                                      onClick={() => setPendingDeleteRow(r)}
                                    >
                                      Apagar
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mobile-record-list">
                        {shown.map((r) => (
                          <article key={r.id} className="mobile-record-card">
                            <div className="mobile-record-top">
                              <div className="mobile-record-main">
                                <strong className="mobile-record-measure">
                                  {r.measure || '—'}
                                </strong>
                                <span aria-hidden="true" className="meta-sep">
                                  ·
                                </span>
                                <span
                                  className={`mobile-record-gauge ${gaugeTextClass(r.gauge)}`}
                                >
                                  {r.gauge} mm
                                </span>
                              </div>
                              <div className="mobile-record-total">
                                {Number(r.total_pieces).toLocaleString('pt-BR')}{' '}
                                pç
                              </div>
                            </div>
                            <div className="mobile-record-bottom">
                              <div className="mobile-record-meta">
                                <span>
                                  {fmtDate(rowDate(r.production_date))}
                                </span>
                                <span aria-hidden="true" className="meta-sep">
                                  ·
                                </span>
                                <span>{r.package_type}</span>
                                <span aria-hidden="true" className="meta-sep">
                                  ·
                                </span>
                                <span>
                                  {Number(r.pieces_per_unit).toLocaleString(
                                    'pt-BR'
                                  )}{' '}
                                  × {Number(r.units).toLocaleString('pt-BR')}
                                </span>
                              </div>
                              {isAdmin && (
                                <div className="mobile-record-actions">
                                  <button
                                    className="btn secondary small"
                                    type="button"
                                    onClick={() => beginEdit(r)}
                                  >
                                    Alterar
                                  </button>
                                  <button
                                    className="btn danger small"
                                    type="button"
                                    onClick={() => setPendingDeleteRow(r)}
                                  >
                                    Apagar
                                  </button>
                                </div>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                      {pageCount > 1 && (
                        <div className="pager">
                          <button
                            className="btn secondary small"
                            disabled={currentPage === 0}
                            type="button"
                            onClick={() =>
                              setPages((prev) => ({
                                ...prev,
                                [op]: Math.max(0, currentPage - 1),
                              }))
                            }
                          >
                            Anterior
                          </button>
                          <span>
                            {currentPage * PAGE_SIZE + 1}–
                            {Math.min((currentPage + 1) * PAGE_SIZE, list.length)}{' '}
                            de {list.length}
                          </span>
                          <button
                            className="btn secondary small"
                            disabled={currentPage >= pageCount - 1}
                            type="button"
                            onClick={() =>
                              setPages((prev) => ({
                                ...prev,
                                [op]: Math.min(pageCount - 1, currentPage + 1),
                              }))
                            }
                          >
                            Próxima
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })
          )}
        </div>
      </section>

      <dialog
        ref={confirmDialogRef}
        aria-describedby="productionConfirmHint"
        aria-labelledby="productionConfirmTitle"
        className="confirm-dialog"
        id="productionConfirm"
        onCancel={(e) => {
          e.preventDefault();
          setConfirmModalOpen(false);
        }}
      >
        <h2 id="productionConfirmTitle">Confirme os dados da produção</h2>
        <p id="productionConfirmHint">
          Confira antes de registrar. Nada será salvo até tocar no botão.
        </p>
        <dl className="production-confirm-list" id="productionConfirmDetails">
          <dt>Operador</dt>
          <dd>{getActiveOperator() || '—'}</dd>
          <dt>Data</dt>
          <dd>{date ? fmtDate(date) : '—'}</dd>
          <dt>Tipo de pacote</dt>
          <dd>{kind || '—'}</dd>
          <dt>Estribo</dt>
          <dd>{measure.trim() || '—'}</dd>
          <dt>Bitola</dt>
          <dd>{gauge ? `${gauge} mm` : '—'}</dd>
          <dt>Quantidade de estribos</dt>
          <dd>{Number(pieces || 0).toLocaleString('pt-BR')}</dd>
          <dt>Quantidade de pacotes</dt>
          <dd>{Number(units || 0).toLocaleString('pt-BR')}</dd>
          <dt>Total de peças</dt>
          <dd>{computedTotal}</dd>
        </dl>
        <div className="confirm-actions">
          <button
            className="btn secondary"
            type="button"
            onClick={() => setConfirmModalOpen(false)}
          >
            Cancelar
          </button>
          <button
            ref={confirmBtnRef}
            className="btn"
            id="confirmProductionBtn"
            type="button"
            onClick={() => void executeSave()}
          >
            Confirmar e registrar
          </button>
        </div>
      </dialog>

      <PdfPreviewDialog
        preview={pdfPreview}
        onClose={() => setPdfPreview(null)}
        onNotify={onNotify}
      />

      <ConfirmDialog
        message="Apagar este registro?"
        open={!!pendingDeleteRow}
        onCancel={() => setPendingDeleteRow(null)}
        onConfirm={() => {
          const target = pendingDeleteRow;
          setPendingDeleteRow(null);
          if (target) {
            void onDeleteProduction(target.id);
          }
        }}
      />
    </section>
  );
}
