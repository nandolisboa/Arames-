import { formatCoilWeights } from './coilWeights';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { ARAMES_LOGO_DATA_URL } from '../assets/logo';
import { MESSAGES, OPERATORS, fmtDate, rowDate, today } from '../constants';
import type { CoilRow, DateFilter, ProductionRow } from '../types';

export interface PdfPreviewData {
  type: 'production' | 'coils';
  title: string;
  issuedAt: string;
  filename: string;
  doc: jsPDF;
  downloadSuccessMessage: string;
  productionRows?: ProductionRow[];
  coilRows?: CoilRow[];
}

function addCompanyLogo(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.addImage(
      ARAMES_LOGO_DATA_URL,
      'PNG',
      doc.internal.pageSize.getWidth() - 55,
      4,
      50,
      7.14,
      'arames-brasil-logo',
      'FAST'
    );
  }
}

export function exportProductionExcel(
  rows: ProductionRow[],
  dateFilter: DateFilter,
  onNotify: (msg: string) => void
): void {
  const period =
    dateFilter === 'today'
      ? 'Hoje'
      : dateFilter === 'month'
        ? 'Este mes'
        : 'Todas as datas';

  const groups = OPERATORS.map((op) => ({
    operator: op,
    rows: rows.filter((r) => r.operator === op),
  }));

  const headers = [
    'Data',
    'Bitola mm',
    'Medida do estribo',
    'Pacote',
    'Pecas por pacote',
    'Pacotes',
    'Total pecas',
  ];

  const blockWidth = 8;
  const totalRows = Math.max(0, ...groups.map((g) => g.rows.length));
  const subtotalRow = 4 + totalRows;
  const grandRow = subtotalRow + 1;
  const sheet: (string | number)[][] = [];

  sheet[0] = ['RELATORIO DE PRODUCAO POR OPERADOR'];
  sheet[1] = ['Periodo', period];

  for (let index = 0; index < groups.length; index++) {
    const start = index * blockWidth;
    const g = groups[index];
    if (!sheet[2]) sheet[2] = [];
    sheet[2][start] = 'OPERADOR';
    sheet[2][start + 1] = g.operator;

    for (let i = 0; i < headers.length; i++) {
      if (!sheet[3]) sheet[3] = [];
      sheet[3][start + i] = headers[i];
    }

    for (let i = 0; i < g.rows.length; i++) {
      const r = g.rows[i];
      const values: (string | number)[] = [
        fmtDate(rowDate(r.production_date)),
        r.gauge,
        r.measure,
        r.package_type,
        Number(r.pieces_per_unit),
        Number(r.units),
        Number(r.total_pieces),
      ];
      if (!sheet[4 + i]) sheet[4 + i] = [];
      for (let j = 0; j < values.length; j++) {
        sheet[4 + i][start + j] = values[j];
      }
    }

    if (!sheet[subtotalRow]) sheet[subtotalRow] = [];
    sheet[subtotalRow][start] = `SUBTOTAL ${g.operator}`;
    sheet[subtotalRow][start + 6] = g.rows.reduce(
      (sum, r) => sum + Number(r.total_pieces),
      0
    );
  }

  const overall = groups.reduce(
    (sum, g) => sum + g.rows.reduce((v, r) => v + Number(r.total_pieces), 0),
    0
  );

  if (!sheet[grandRow]) sheet[grandRow] = [];
  sheet[grandRow][0] = 'TOTAL GERAL';
  sheet[grandRow][6] = overall;

  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws['!cols'] = groups.flatMap(() => [
    { wch: 13 },
    { wch: 12 },
    { wch: 22 },
    { wch: 15 },
    { wch: 17 },
    { wch: 12 },
    { wch: 14 },
    { wch: 3 },
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Producao');
  XLSX.writeFile(wb, 'relatorio_producao_por_operador.xlsx');
  onNotify(MESSAGES.xlsxOk);
}

function buildProductionPDFDoc(rows: ProductionRow[]): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 5;
  const pageW = 210;
  const pageH = 297;
  const cols = [
    { label: 'Data', w: 26 },
    { label: 'Bitola', w: 18 },
    { label: 'Medida do estribo', w: 43 },
    { label: 'Pacote', w: 23 },
    { label: 'Qtd de peças', w: 29 },
    { label: 'Qtd de pacotes', w: 39 },
    { label: 'Total', w: 22 },
  ];
  let y = 0;

  const pageTop = () => {
    doc.setTextColor(0, 0, 0);
    doc.setFont('courier', 'bold');
    doc.setFontSize(12);
    doc.text(MESSAGES.reportTitle, margin, 10);
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.text(`Emitido em ${fmtDate(today())}`, margin, 15);
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.15);
    doc.line(margin, 17, pageW - margin, 17);
    y = 19;
  };

  const tableHead = () => {
    const h = 10;
    let x = margin;
    doc.setFont('courier', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.12);
    for (const col of cols) {
      doc.rect(x, y, col.w, h);
      const label = doc.splitTextToSize(col.label, col.w - 2);
      doc.text(label, x + 1, y + 3.5, { lineHeightFactor: 1.1 });
      x += col.w;
    }
    y += h;
  };

  const operatorHeader = (operator: string, continuation = false) => {
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.text(`${operator}${continuation ? ' (continuação)' : ''}`, margin, y + 3);
    y += 5;
    tableHead();
  };

  const nextPage = (operator?: string) => {
    doc.addPage('a4', 'portrait');
    pageTop();
    if (operator) operatorHeader(operator, true);
  };

  pageTop();
  const activeOperators = OPERATORS.filter((op) => rows.some((r) => r.operator === op));
  if (!rows.length) {
    doc.setFontSize(9);
    doc.text(MESSAGES.reportNoRows, margin, y + 6);
  } else {
    for (const [operatorIndex, op] of activeOperators.entries()) {
      const list = rows.filter((r) => r.operator === op);
      if (operatorIndex > 0) nextPage();
      operatorHeader(op);
      let subtotal = 0;
      for (const [index, row] of list.entries()) {
        const values = [
          fmtDate(rowDate(row.production_date)),
          `${String(row.gauge)} mm`,
          String(row.measure || ''),
          String(row.package_type),
          Number(row.pieces_per_unit).toLocaleString('pt-BR'),
          Number(row.units).toLocaleString('pt-BR'),
          Number(row.total_pieces).toLocaleString('pt-BR'),
        ];
        doc.setFont('courier', 'normal');
        doc.setFontSize(7.4);
        const cells = values.map((v, i) => doc.splitTextToSize(v, cols[i].w - 2));
        const lineCount = Math.max(...cells.map((cell: string[]) => cell.length));
        const rowHeight = Math.max(7.55, lineCount * 3.1 + 2);
        const lastOfGroup = index === list.length - 1;
        const lastGroup = op === activeOperators[activeOperators.length - 1];
        const footer = lastOfGroup ? 8 + (lastGroup ? 8 : 0) : 0;
        if (y + rowHeight + footer > pageH - margin) nextPage(op);
        let x = margin;
        doc.setDrawColor(160, 160, 160);
        doc.setLineWidth(0.1);
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i];
          doc.rect(x, y, col.w, rowHeight);
          doc.setFont('courier', 'normal');
          doc.setFontSize(7.4);
          doc.setTextColor(0, 0, 0);
          if (i >= 4) {
            doc.text(cells[i], x + col.w - 1, y + 4.8, { align: 'right', lineHeightFactor: 1.1 });
          } else {
            doc.text(cells[i], x + 1, y + 4.8, { lineHeightFactor: 1.1 });
          }
          x += col.w;
        }
        y += rowHeight;
        subtotal += Number(row.total_pieces);
      }
      if (y + 8 > pageH - margin) nextPage();
      doc.setFont('courier', 'bold');
      doc.setFontSize(7.4);
      doc.text(`Subtotal ${op}: ${subtotal.toLocaleString('pt-BR')} peças`, pageW - margin, y + 4.5, { align: 'right' });
      y += 8;
    }
    if (y + 8 > pageH - margin) nextPage();
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, y, pageW - margin, y);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    const grandTotal = rows.reduce((sum, row) => sum + Number(row.total_pieces), 0);
    doc.text(`TOTAL GERAL: ${grandTotal.toLocaleString('pt-BR')} peças`, pageW - margin, y + 5, { align: 'right' });
  }
  addCompanyLogo(doc);
  return doc;
}

export function downloadProductionPDF(
  rows: ProductionRow[],
  onNotify: (msg: string) => void
): void {
  try {
    const doc = buildProductionPDFDoc(rows);
    doc.save('relatorio_producao_estribos.pdf');
    onNotify(MESSAGES.pdfProductionOk);
  } catch (e) {
    console.error(e);
    onNotify('Não foi possível gerar o PDF da produção. Tente novamente.');
  }
}

export function createProductionPdfPreview(
  rows: ProductionRow[],
  onNotify: (msg: string) => void
): PdfPreviewData | null {
  try {
    const doc = buildProductionPDFDoc(rows);
    return {
      type: 'production',
      title: MESSAGES.reportTitle,
      issuedAt: fmtDate(today()),
      filename: 'relatorio_producao_estribos.pdf',
      doc,
      downloadSuccessMessage: MESSAGES.pdfProductionOk,
      productionRows: rows,
    };
  } catch (e) {
    console.error(e);
    onNotify('Não foi possível gerar o PDF da produção. Tente novamente.');
    return null;
  }
}

function buildCoilsPDFDoc(coilRows: CoilRow[]): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });
  const margin = 14;
  const pageH = 210;
  const cols = [
    { label: 'Bobina (mm)', w: 27 },
    { label: 'Fabricante', w: 75 },
    { label: 'Nº da NF', w: 60 },
    { label: 'Série', w: 18 },
    { label: 'Peso (kg)', w: 43 },
    { label: 'Origem do peso', w: 46 },
  ];
  let y = 0;

  const pageTop = () => {
    doc.setFont('courier', 'bold');
    doc.setFontSize(16);
    doc.text(MESSAGES.coilsTitle, margin, 15);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(`Emitido em ${fmtDate(today())}`, margin, 21);
    y = 28;
  };

  const header = () => {
    let x = margin;
    const h = 9;
    doc.setDrawColor(195, 202, 208);
    doc.setTextColor(0, 0, 0);
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    for (const c of cols) {
      doc.text(c.label, x + 2, y + 6);
      x += c.w;
    }
    doc.line(margin, y + h, 283, y + h);
    y += h;
  };

  const nextPage = () => {
    doc.addPage('a4', 'landscape');
    pageTop();
    header();
  };

  pageTop();
  header();

  const rows = coilRows.length
    ? coilRows.map((c) => [
        `${String(c.gauge)} mm`,
        String(c.manufacturer || ''),
        String(c.invoice_number || ''),
        String(c.invoice_series || ''),
        formatCoilWeights(c),
        c.weight_source === 'ETIQUETA' ? 'Etiqueta' : c.weight_source === 'AMBOS' ? 'Ambos' : 'Balança',
      ])
    : [['', '', '', '', '', 'Nenhuma bobina cadastrada']];

  for (const row of rows) {
    const cells = row.map((v, i) =>
      doc.splitTextToSize(String(v), cols[i].w - 4)
    );
    let lines = 1;
    for (const c of cells) lines = Math.max(lines, c.length);
    const h = Math.max(9, lines * 4.5 + 3);
    if (y + h > pageH - 13) nextPage();
    let x = margin;
    for (let i = 0; i < cols.length; i++) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text(cells[i], x + 2, y + 5.8);
      x += cols[i].w;
    }
    doc.setDrawColor(230, 233, 236);
    doc.line(14, y + h, 283, y + h);
    y += h;
  }

  addCompanyLogo(doc);
  return doc;
}

export function downloadCoilsPDF(
  coilRows: CoilRow[],
  onNotify: (msg: string) => void
): void {
  try {
    const doc = buildCoilsPDFDoc(coilRows);
    doc.save('relatorio_bobinas.pdf');
    onNotify(MESSAGES.pdfCoilsOk);
  } catch (e) {
    console.error(e);
    onNotify('Não foi possível gerar o PDF das bobinas. Tente novamente.');
  }
}

export function createCoilsPdfPreview(
  coilRows: CoilRow[],
  onNotify: (msg: string) => void
): PdfPreviewData | null {
  try {
    const doc = buildCoilsPDFDoc(coilRows);
    return {
      type: 'coils',
      title: MESSAGES.coilsTitle,
      issuedAt: fmtDate(today()),
      filename: 'relatorio_bobinas.pdf',
      doc,
      downloadSuccessMessage: MESSAGES.pdfCoilsOk,
      coilRows,
    };
  } catch (e) {
    console.error(e);
    onNotify('Não foi possível gerar o PDF das bobinas. Tente novamente.');
    return null;
  }
}
