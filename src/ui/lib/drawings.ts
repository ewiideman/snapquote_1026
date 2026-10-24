// The quote's drawings and models for one part, for the pricing panel: the files that show a part
// (PDFs, images, CAD), not the emails and parts lists, with the part's own first -- a file attached
// to the part, or one whose name holds its part number (NR-1210_RevA.pdf for NR-1210). Pure.

export interface FileRef { id: number; lineId: number | null; fileName: string }

const DRAWING = /\.(pdf|png|jpe?g|gif|tiff?|bmp|dxf|dwg|step|stp|igs|iges|x_t|x_b|sldprt|sldasm|prt|stl|3mf|ipt|catpart|jt)$/i;
/** Files the browser shows itself; the rest are downloaded to open in their own program. */
const SHOWN = /\.(pdf|png|jpe?g|gif)$/i;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function drawingsFor<T extends FileRef>(files: readonly T[], part: { id: number; partNumber: string }): { file: T; own: boolean; opens: boolean }[] {
  const pn = squash(part.partNumber);
  const own = (f: T) => f.lineId === part.id || (pn.length >= 3 && squash(f.fileName.replace(/\.[^.]+$/, '')).includes(pn));
  return files
    .filter((f) => DRAWING.test(f.fileName))
    .map((f) => ({ file: f, own: own(f), opens: SHOWN.test(f.fileName) }))
    .sort((a, b) => Number(b.own) - Number(a.own));
}
