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
      233,
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
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });
  const margin = 14;
  const pageW = 297;
  const pageH = 210;
  const cols = [
    { label: 'Data', w: 25 },
    { label: 'Bitola', w: 25 },
    { label: 'Medida do estribo', w: 58 },
    { label: 'Pacote', w: 35 },
    { label: 'Qtd de pecas', w: 39 },
    { label: 'Qtd de pacotes', w: 40 },
    { label: 'Total', w: 33 },
  ];
  let y = 0;

  const pageTop = () => {
    doc.setFont('courier', 'bold');
    doc.setFontSize(15);
    doc.text(MESSAGES.reportTitle, margin, 14);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(`Emitido em ${fmtDate(today())}`, margin, 19);
    y = 25;
  };

  const tableHead = () => {
    let x = margin;
    const h = 8;
    doc.setDrawColor(195, 202, 208);
    doc.setTextColor(0, 0, 0);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    for (const c of cols) {
      doc.text(c.label, x + 1.5, y + 5.2);
      x += c.w;
    }
    doc.line(margin, y + h, pageW - margin, y + h);
    y += h;
  };

  const newPage = () => {
    doc.addPage('a4', 'landscape');
    pageTop();
  };

  pageTop();

  if (!rows.length) {
    doc.setFontSize(10);
    doc.text(MESSAGES.reportNoRows, margin, y + 7);
  } else {
    for (const op of OPERATORS) {
      const list = rows.filter((r) => r.operator === op);
      if (!list.length) continue;
      if (y + 19 > pageH - 12) newPage();
      doc.setFont('courier', 'bold');
      doc.setFontSize(10);
      doc.text(op, margin, y + 6);
      y += 9;
      tableHead();
      let subtotal = 0;

      for (const r of list) {
        const vals = [
          fmtDate(rowDate(r.production_date)),
          `${String(r.gauge)} mm`,
          String(r.measure || ''),
          String(r.package_type),
          Number(r.pieces_per_unit).toLocaleString('pt-BR'),
          Number(r.units).toLocaleString('pt-BR'),
          Number(r.total_pieces).toLocaleString('pt-BR'),
        ];
        const cells = vals.map((v, i) =>
          doc.splitTextToSize(String(v), cols[i].w - 3)
        );
        let lines = 1;
        for (const c of cells) lines = Math.max(lines, c.length);
        const h = Math.max(7, lines * 4 + 2);

        if (y + h > pageH - 15) {
          newPage();
          doc.setFont('courier', 'bold');
          doc.setFontSize(10);
          doc.text(`${op} (continuacao)`, margin, y + 6);
          y += 9;
          tableHead();
        }

        let x = margin;
        for (let i = 0; i < cols.length; i++) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(0, 0, 0);
          doc.text(cells[i], x + 1.5, y + 4.8);
          x += cols[i].w;
        }
        doc.setDrawColor(230, 233, 236);
        doc.line(margin, y + h, pageW - margin, y + h);
        y += h;
        subtotal += Number(r.total_pieces);
      }

      if (y + 9 > pageH - 12) newPage();
      doc.setFont('courier', 'bold');
      doc.setFontSize(8);
      doc.text(
        `Subtotal ${op}: ${subtotal.toLocaleString('pt-BR')} pecas`,
        pageW - margin,
        y + 5,
        { align: 'right' }
      );
      y += 9;
    }

    if (y + 10 > pageH - 12) newPage();
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.text(
      `TOTAL GERAL: ${rows
        .reduce((a, r) => a + Number(r.total_pieces), 0)
        .toLocaleString('pt-BR')} pecas`,
      pageW - margin,
      y + 5,
      { align: 'right' }
    );
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
