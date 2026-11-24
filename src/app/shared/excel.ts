// Exportación a Excel (.xlsx) con ExcelJS, cargado solo cuando se usa
export interface Columna { h: string; k: string; w?: number; money?: boolean; num?: boolean }

export async function exportarExcel(nombre: string, hoja: string, columnas: Columna[], filas: Record<string, unknown>[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lubricentro Ramos';
  const ws = wb.addWorksheet(hoja, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columnas.map((c) => ({ header: c.h, key: c.k, width: c.w || 14 }));
  filas.forEach((f) => ws.addRow(f));
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A44' } };
  columnas.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 1).numFmt = '"S/" #,##0.00';
    else if (c.num) ws.getColumn(i + 1).numFmt = '#,##0.###';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${nombre}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
