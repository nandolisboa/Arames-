import { formatCoilWeights } from '../lib/coilWeights';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ARAMES_LOGO_DATA_URL } from '../assets/logo';
import { MESSAGES, OPERATORS, fmtDate, rowDate } from '../constants';
import type { PdfPreviewData } from '../lib/reports';

interface ReportDocumentProps {
  preview: PdfPreviewData;
}

function ReportDocument({ preview }: ReportDocumentProps) {
  if (preview.type === 'production') {
    const rows = preview.productionRows || [];
    const grandTotal = rows.reduce((a, r) => a + Number(r.total_pieces), 0);

    return (
      <div className="report-sheet">
        <div className="report-sheet-header">
          <div>
            <h1 className="ptitle">{preview.title}</h1>
            <div className="pmeta">Emitido em {preview.issuedAt}</div>
          </div>
          <img
            alt="Arames Brasil"
            className="report-sheet-logo"
            src={ARAMES_LOGO_DATA_URL}
          />
        </div>

        {!rows.length ? (
          <div className="report-empty">{MESSAGES.reportNoRows}</div>
        ) : (
          <>
            {OPERATORS.map((op) => {
              const list = rows.filter((r) => r.operator === op);
              if (!list.length) return null;
              const subtotal = list.reduce(
                (acc, r) => acc + Number(r.total_pieces),
                0
              );

              return (
                <div key={op} className="pgroup">
                  <h2>{op}</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Bitola</th>
                        <th>Medida do estribo</th>
                        <th>Pacote</th>
                        <th className="num">Qtd de peças</th>
                        <th className="num">Qtd de pacotes</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.id}>
                          <td>{fmtDate(rowDate(r.production_date))}</td>
                          <td>{r.gauge} mm</td>
                          <td>{r.measure || ''}</td>
                          <td>{r.package_type}</td>
                          <td className="num">
                            {Number(r.pieces_per_unit).toLocaleString('pt-BR')}
                          </td>
                          <td className="num">
                            {Number(r.units).toLocaleString('pt-BR')}
                          </td>
                          <td className="num">
                            {Number(r.total_pieces).toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="psum">
                    Subtotal {op}: {subtotal.toLocaleString('pt-BR')} peças
                  </div>
                </div>
              );
            })}
            <div className="report-grand-total">
              TOTAL GERAL: {grandTotal.toLocaleString('pt-BR')} peças
            </div>
          </>
        )}
      </div>
    );
  }

  const coilRows = preview.coilRows || [];

  return (
    <div className="report-sheet">
      <div className="report-sheet-header">
        <div>
          <h1 className="ptitle">{preview.title}</h1>
          <div className="pmeta">Emitido em {preview.issuedAt}</div>
        </div>
        <img
          alt="Arames Brasil"
          className="report-sheet-logo"
          src={ARAMES_LOGO_DATA_URL}
        />
      </div>

      <div className="pgroup">
        <table>
          <thead>
            <tr>
              <th>Bobina (mm)</th>
              <th>Fabricante</th>
              <th>Nº da NF</th>
              <th>Série</th>
              <th className="num">Peso (kg)</th>
              <th>Origem do peso</th>
            </tr>
          </thead>
          <tbody>
            {coilRows.length ? (
              coilRows.map((c) => (
                <tr key={c.id}>
                  <td>{c.gauge} mm</td>
                  <td>{c.manufacturer || ''}</td>
                  <td>{c.invoice_number || ''}</td>
                  <td>{c.invoice_series || ''}</td>
                  <td className="num">
                    {formatCoilWeights(c)}
                  </td>
                  <td>
                    {c.weight_source === 'ETIQUETA' ? 'Etiqueta' : c.weight_source === 'AMBOS' ? 'Ambos' : 'Balança'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>Nenhuma bobina cadastrada</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PdfPreviewDialogProps {
  preview: PdfPreviewData | null;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export function PdfPreviewDialog({
  preview,
  onClose,
  onNotify,
}: PdfPreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (preview && !dlg.open) {
      dlg.showModal();
    } else if (!preview && dlg.open) {
      dlg.close();
    }
  }, [preview]);

  const printAreaEl =
    typeof document !== 'undefined'
      ? document.getElementById('printArea')
      : null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby="pdfPreviewTitle"
        className="confirm-dialog pdf-preview-dialog"
        id="pdfPreviewDialog"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) {
            onClose();
          }
        }}
      >
        {preview && (
          <>
            <div className="pdf-preview-head">
              <h2 id="pdfPreviewTitle">Pré-visualização — {preview.title}</h2>
              <div className="pdf-preview-actions">
                <button
                  className="btn secondary small"
                  type="button"
                  onClick={() => {
                    preview.doc.save(preview.filename);
                    onNotify(preview.downloadSuccessMessage);
                  }}
                >
                  Baixar PDF
                </button>
                <button
                  className="btn small"
                  type="button"
                  onClick={handlePrint}
                >
                  Imprimir
                </button>
                <button
                  className="btn secondary small"
                  type="button"
                  onClick={onClose}
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="pdf-preview-scroll">
              <ReportDocument preview={preview} />
            </div>
          </>
        )}
      </dialog>

      {preview && printAreaEl
        ? createPortal(<ReportDocument preview={preview} />, printAreaEl)
        : null}
    </>
  );
}
