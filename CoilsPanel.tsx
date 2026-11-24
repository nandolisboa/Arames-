import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GAUGES, gaugeTextClass } from '../constants';
import {
  createCoilsPdfPreview,
  downloadCoilsPDF,
  type PdfPreviewData,
} from '../lib/reports';
import type { CoilRow } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { PdfPreviewDialog } from './PdfPreviewDialog';
import { formatCoilWeights } from '../lib/coilWeights';

interface CoilsPanelProps {
  visible: boolean;
  isAdmin: boolean;
  canSeeCoils: boolean;
  coilsLoaded: boolean;
  coilsLoading: boolean;
  coilsError: string;
  coilRows: CoilRow[];
  onSaveCoil: (payload: {
    gauge: string;
    manufacturer: string;
    weight_kg: number;
    weight_label_kg: number | null;
    weight_scale_kg: number | null;
    weight_source: string;
    invoice_number: string;
    invoice_series: string | null;
  }) => Promise<boolean>;
  onDeleteCoil: (id: string | number) => Promise<void>;
  onNotify: (msg: string) => void;
}

export function CoilsPanel({
  visible,
  isAdmin,
  canSeeCoils,
  coilsLoaded,
  coilsLoading,
  coilsError,
  coilRows,
  onSaveCoil,
  onDeleteCoil,
  onNotify,
}: CoilsPanelProps) {
  const [coilGauge, setCoilGauge] = useState('');
  const [coilManufacturer, setCoilManufacturer] = useState('');
  const [labelWeight, setLabelWeight] = useState('');
  const [scaleWeight, setScaleWeight] = useState('');
  const [coilSource, setCoilSource] = useState('ETIQUETA');
  const [coilInvoiceNumber, setCoilInvoiceNumber] = useState('');
  const [coilInvoiceSeries, setCoilInvoiceSeries] = useState('');
  const [coilSearch, setCoilSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [mobileView, setMobileView] = useState<'form' | 'list'>('list');

  const [debouncedMakerQuery, setDebouncedMakerQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pendingDeleteCoil, setPendingDeleteCoil] = useState<CoilRow | null>(null);
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewData | null>(null);

  const coilGaugeRef = useRef<HTMLButtonElement>(null);
  const makerInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedMakerQuery(coilManufacturer.trim().toLocaleLowerCase('pt-BR'));
    }, 120);
    return () => clearTimeout(timer);
  }, [coilManufacturer]);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(target) &&
        target !== makerInputRef.current
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  const makerSuggestions = useMemo(() => {
    if (debouncedMakerQuery.length < 1) return [];
    const seen = new Set<string>();
    const matches: { coil: CoilRow; label: string }[] = [];

    for (const c of coilRows) {
      const maker = String(c.manufacturer || '');
      const key = [c.gauge, maker, c.weight_kg, c.weight_source].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const label = `${maker} — ${c.gauge} mm — ${formatCoilWeights(c)} — ${c.weight_source === 'ETIQUETA' ? 'Etiqueta' : c.weight_source === 'AMBOS' ? 'Ambos' : 'Balança'}`;
      if (
        `${maker} ${c.gauge} ${c.weight_kg}`
          .toLocaleLowerCase('pt-BR')
          .includes(debouncedMakerQuery)
      ) {
        matches.push({ coil: c, label });
      }
    }
    return matches.slice(0, 8);
  }, [coilRows, debouncedMakerQuery]);

  const filteredCoils = useMemo(() => {
    const query = coilSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return coilRows;
    return coilRows.filter((c) =>
      [c.invoice_number, c.invoice_series, c.manufacturer].some((v) =>
        String(v || '').toLocaleLowerCase('pt-BR').includes(query)
      )
    );
  }, [coilRows, coilSearch]);

  const handleSave = async () => {
    if (!isAdmin) return;
    const manufacturer = coilManufacturer.trim();
    const parseWeight = (text: string) => {
      const normalized = text.trim().replace(',', '.');
      const n = Number(normalized);
      return /^[0-9]+(?:\.[0-9]{1,3})?$/.test(normalized) && n > 0 && n <= 100000 ? n : null;
    };
    const label = parseWeight(labelWeight);
    const scale = parseWeight(scaleWeight);
    const weight = coilSource === 'BALANCA' ? scale : label;
    const invoiceNumber = coilInvoiceNumber.trim();
    const invoiceSeries = coilInvoiceSeries.trim();

    if (
      !GAUGES.includes(coilGauge as (typeof GAUGES)[number]) ||
      !manufacturer ||
      manufacturer.length > 80 ||
      weight === null ||
      (coilSource === 'AMBOS' && (label === null || scale === null)) ||
      !['ETIQUETA', 'BALANCA', 'AMBOS'].includes(coilSource) ||
      !invoiceNumber ||
      invoiceNumber.length > 40 ||
      invoiceSeries.length > 20
    ) {
      onNotify('Preencha os dados da bobina e informe o número da nota fiscal');
      return;
    }

    setSaving(true);
    try {
      const ok = await onSaveCoil({
        gauge: coilGauge,
        manufacturer,
        weight_kg: weight,
        weight_label_kg: coilSource === 'BALANCA' ? null : label,
        weight_scale_kg: coilSource === 'ETIQUETA' ? null : scale,
        weight_source: coilSource,
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries || null,
      });
      if (ok) {
        setCoilGauge('');
        setCoilManufacturer('');
        setLabelWeight('');
        setScaleWeight('');
        setCoilSource('ETIQUETA');
        setCoilInvoiceNumber('');
        setCoilInvoiceSeries('');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleMakerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = suggestionsRef.current;
    if (!list) return;
    const options = Array.from(
      list.querySelectorAll<HTMLButtonElement>('button.autocomplete-option')
    );
    if (!options.length) return;
    e.preventDefault();
    (e.key === 'ArrowDown' ? options[0] : options[options.length - 1]).focus();
  };

  const handleSuggestionsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
      makerInputRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = suggestionsRef.current;
    if (!list) return;
    const options = Array.from(
      list.querySelectorAll<HTMLButtonElement>('button.autocomplete-option')
    );
    if (!options.length) return;
    e.preventDefault();
    const idx = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      (idx + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  };

  const handlePdf = (print: boolean) => {
    if (!canSeeCoils) return;
    if (!coilsLoaded) {
      onNotify('Aguarde as bobinas carregarem antes de gerar o PDF.');
      return;
    }
    if (print) {
      const preview = createCoilsPdfPreview(coilRows, onNotify);
      if (preview) setPdfPreview(preview);
    } else {
      downloadCoilsPDF(coilRows, onNotify);
    }
  };

  if (!visible) return null;

  return (
    <section id="coilsPanel">
      {isAdmin && (
        <div
          aria-label="Alternar entre cadastro e lista de bobinas"
          className="mobile-view-switch"
          role="tablist"
        >
          <button
            aria-selected={mobileView === 'list'}
            className={`mobile-view-btn${mobileView === 'list' ? ' active' : ''}`}
            role="tab"
            type="button"
            onClick={() => setMobileView('list')}
          >
            Bobinas ({filteredCoils.length})
          </button>
          <button
            aria-selected={mobileView === 'form'}
            className={`mobile-view-btn${mobileView === 'form' ? ' active' : ''}`}
            role="tab"
            type="button"
            onClick={() => setMobileView('form')}
          >
            Cadastrar
          </button>
        </div>
      )}

      {isAdmin && (
        <section
          className={`card${mobileView !== 'form' ? ' mobile-pane-hidden' : ''}`}
          id="coilFormCard"
        >
          <h2>Cadastrar bobina</h2>
          <div className="coil-form">
            <div className="field">
              <label htmlFor="coilGauge">Bobina (mm)</label>
              <button
                ref={coilGaugeRef}
                aria-label={`Bobina (mm): ${coilGauge || 'não selecionada'}. Toque para mudar.`}
                aria-required="true"
                className={`btn secondary gauge-toggle ${gaugeTextClass(coilGauge)}`}
                id="coilGauge"
                type="button"
                onClick={() => {
                  const currentIndex = GAUGES.indexOf(coilGauge as (typeof GAUGES)[number]);
                  setCoilGauge(GAUGES[(currentIndex + 1) % GAUGES.length]);
                }}
              >
                {coilGauge || 'Selecione'}
              </button>
            </div>
            <div className="field coil-maker-field">
              <label htmlFor="coilManufacturer">Fabricante</label>
              <input
                ref={makerInputRef}
                autoComplete="off"
                id="coilManufacturer"
                maxLength={80}
                placeholder="Fabricante"
                type="text"
                value={coilManufacturer}
                onChange={(e) => {
                  setCoilManufacturer(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleMakerKeyDown}
              />
              <div
                ref={suggestionsRef}
                className={`autocomplete-list${
                  showSuggestions && makerSuggestions.length > 0 ? '' : ' hidden'
                }`}
                id="coilSuggestions"
                role="listbox"
                onKeyDown={handleSuggestionsKeyDown}
              >
                {makerSuggestions.map(({ coil, label }) => (
                  <button
                    key={`${coil.id}-${label}`}
                    className="autocomplete-option"
                    role="option"
                    type="button"
                    onClick={() => {
                      setCoilGauge(String(coil.gauge));
                      setCoilManufacturer(String(coil.manufacturer));
                      setLabelWeight(String(coil.weight_label_kg ?? (coil.weight_source === 'ETIQUETA' ? coil.weight_kg : '')).replace('.', ','));
                      setScaleWeight(String(coil.weight_scale_kg ?? (coil.weight_source === 'BALANCA' ? coil.weight_kg : '')).replace('.', ','));
                      setCoilSource(String(coil.weight_source));
                      setShowSuggestions(false);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {(coilSource === 'ETIQUETA' || coilSource === 'AMBOS') && (
              <div className="field">
                <label htmlFor="coilWeightLabel">Peso etiqueta (kg)</label>
                <input id="coilWeightLabel" inputMode="decimal" maxLength={12} placeholder="0,000" type="text"
                  value={labelWeight} onChange={(e) => setLabelWeight(e.target.value)} />
              </div>
            )}
            {(coilSource === 'BALANCA' || coilSource === 'AMBOS') && (
              <div className="field">
                <label htmlFor="coilWeightScale">Peso balança (kg)</label>
                <input id="coilWeightScale" inputMode="decimal" maxLength={12} placeholder="0,000" type="text"
                  value={scaleWeight} onChange={(e) => setScaleWeight(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="coilSource">Peso informado por</label>
              <button
                id="coilSource"
                type="button"
                className="btn btn-secondary"
                aria-label={`Peso informado por: ${coilSource === 'ETIQUETA' ? 'Etiqueta' : coilSource === 'BALANCA' ? 'Balança' : 'Ambos'}. Toque para mudar.`}
                onClick={() => setCoilSource((source) => source === 'ETIQUETA' ? 'BALANCA' : source === 'BALANCA' ? 'AMBOS' : 'ETIQUETA')}
              >
                {coilSource === 'ETIQUETA' ? 'Etiqueta' : coilSource === 'BALANCA' ? 'Balança' : 'Ambos'}
              </button>
            </div>
            <div className="field">
              <label htmlFor="coilInvoiceNumber">Nº da nota fiscal</label>
              <input
                id="coilInvoiceNumber"
                maxLength={40}
                placeholder="Número da NF"
                type="text"
                value={coilInvoiceNumber}
                onChange={(e) => setCoilInvoiceNumber(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="coilInvoiceSeries">Série</label>
              <input
                id="coilInvoiceSeries"
                maxLength={20}
                placeholder="Série (opcional)"
                type="text"
                value={coilInvoiceSeries}
                onChange={(e) => setCoilInvoiceSeries(e.target.value)}
              />
            </div>
          </div>
          <div className="actions">
            <button
              className="btn"
              disabled={saving}
              id="saveCoilBtn"
              type="button"
              onClick={() => void handleSave()}
            >
              Salvar bobina
            </button>
          </div>
        </section>
      )}

      <section
        className={`card${isAdmin && mobileView !== 'list' ? ' mobile-pane-hidden' : ''}`}
      >
        <div className="sectionhead">
          <h2>Bobinas</h2>
          <div className="tools">
            <button
              className="btn secondary small"
              id="pdfCoilsBtn"
              type="button"
              onClick={() => handlePdf(false)}
            >
              PDF
            </button>
            <button
              className="btn secondary small"
              id="printCoilsBtn"
              type="button"
              onClick={() => handlePdf(true)}
            >
              Imprimir
            </button>
          </div>
        </div>
        <div className="field coil-search-field">
          <label htmlFor="coilSearch">Buscar bobina por NF ou fabricante</label>
          <div className="search-input-wrap">
            <Search aria-hidden="true" className="search-icon" size={16} />
            <input
              id="coilSearch"
              maxLength={80}
              placeholder="Digite o número da NF, série ou fabricante"
              type="search"
              value={coilSearch}
              onChange={(e) => setCoilSearch(e.target.value)}
            />
          </div>
        </div>

        {coilsLoading ? (
          <div className="empty" id="coilsRecords">
            Carregando bobinas…
          </div>
        ) : coilsError ? (
          <div className="empty" id="coilsRecords">
            {coilsError}
          </div>
        ) : !coilRows.length ? (
          <div className="empty" id="coilsRecords">
            Nenhuma bobina cadastrada.
          </div>
        ) : !filteredCoils.length ? (
          <div className="empty" id="coilsRecords">
            Nenhuma bobina encontrada para essa busca.
          </div>
        ) : (
          <div id="coilsRecords">
            <div className="coils-table-wrap">
              <table className="coils-table">
                <thead>
                  <tr>
                    <th>Bobina</th>
                    <th>Fabricante</th>
                    <th>NF</th>
                    <th>Série</th>
                    <th className="num">Peso (kg)</th>
                    <th>Origem do peso</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {filteredCoils.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong className={gaugeTextClass(c.gauge)}>
                          {c.gauge} mm
                        </strong>
                      </td>
                      <td>{c.manufacturer}</td>
                      <td>{c.invoice_number || '—'}</td>
                      <td>{c.invoice_series || '—'}</td>
                      <td className="num">
                        {formatCoilWeights(c)}
                      </td>
                      <td>
                        {c.weight_source === 'ETIQUETA' ? 'Etiqueta' : c.weight_source === 'AMBOS' ? 'Ambos' : 'Balança'}
                      </td>
                      {isAdmin && (
                        <td className="saved-actions">
                          <button
                            className="btn danger small"
                            type="button"
                            onClick={() => setPendingDeleteCoil(c)}
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
              {filteredCoils.map((c) => (
                <article key={c.id} className="mobile-record-card">
                  <div className={c.weight_source === 'AMBOS' ? 'mobile-record-top mobile-coil-both' : 'mobile-record-top'}>
                    <div className="mobile-record-main">
                      <strong
                        className={`mobile-record-gauge ${gaugeTextClass(c.gauge)}`}
                      >
                        {c.gauge} mm
                      </strong>
                      <span aria-hidden="true" className="meta-sep">
                        ·
                      </span>
                      <span className="mobile-record-measure">
                        {c.manufacturer}
                      </span>
                    </div>
                    <div className="mobile-record-total">
                      {c.weight_source === 'AMBOS' && c.weight_label_kg != null && c.weight_scale_kg != null
                        ? formatCoilWeights(c).split(' / ').map((weight) => (
                            <div key={weight}>
                              {weight.replace('Etiqueta:', 'Etiq.').replace('Balança:', 'Bal.')}
                            </div>
                          ))
                        : `${c.weight_source === 'ETIQUETA' ? 'Etiq.' : 'Bal.'} ${formatCoilWeights(c)}`}
                    </div>
                  </div>
                  <div className="mobile-record-bottom">
                    <div className="mobile-record-meta">
                      <span>NF {c.invoice_number || '—'}</span>
                      <span aria-hidden="true" className="meta-sep">
                        ·
                      </span>
                      <span>Série {c.invoice_series || '—'}</span>
                      <span aria-hidden="true" className="meta-sep">
                        ·
                      </span>
                      <span>
                        {c.weight_source === 'ETIQUETA' ? 'Etiqueta' : c.weight_source === 'AMBOS' ? 'Ambos' : 'Balança'}
                      </span>
                    </div>
                    {isAdmin && (
                      <div className="mobile-record-actions">
                        <button
                          className="btn danger small"
                          type="button"
                          onClick={() => setPendingDeleteCoil(c)}
                        >
                          Apagar
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <PdfPreviewDialog
        preview={pdfPreview}
        onClose={() => setPdfPreview(null)}
        onNotify={onNotify}
      />

      <ConfirmDialog
        message={
          pendingDeleteCoil
            ? `Apagar a bobina ${pendingDeleteCoil.gauge} mm — ${pendingDeleteCoil.manufacturer}?`
            : ''
        }
        open={!!pendingDeleteCoil}
        onCancel={() => setPendingDeleteCoil(null)}
        onConfirm={() => {
          const target = pendingDeleteCoil;
          setPendingDeleteCoil(null);
          if (target) {
            void onDeleteCoil(target.id);
          }
        }}
      />
    </section>
  );
}
