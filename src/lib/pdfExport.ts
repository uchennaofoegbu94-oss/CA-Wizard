import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// Renders a DOM node to a genuine PDF file client-side. This is
// deliberately NOT window.print() — browser print output always
// carries the browser's own header/footer/URL chrome unless the
// person manually disables it in their print dialog, which isn't
// something a web app can control. A real generated PDF has none
// of that by construction.
export async function exportNodeToPdf(node: HTMLElement, filename: string): Promise<void> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  await drawNodeIntoPdf(pdf, node, { startNewPage: false })
  pdf.save(filename)
}

// Renders `node` to a canvas and draws it into an already-constructed jsPDF
// document, starting a new page first if requested. Extracted out of
// exportNodeToPdf so both the single-document export above and the bulk
// combined-PDF builder below share one code path for the actual
// html2canvas → jsPDF pagination math, rather than maintaining it twice.
async function drawNodeIntoPdf(pdf: jsPDF, node: HTMLElement, opts: { startNewPage: boolean }): Promise<void> {
  const canvas = await html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff'
  })

  const imgData = canvas.toDataURL('image/png')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const imgWidth = pageWidth
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  let heightLeft = imgHeight
  let position = 0
  let firstPageOfThisNode = true

  if (opts.startNewPage) pdf.addPage()

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
  heightLeft -= pageHeight
  firstPageOfThisNode = false

  // Multi-page support for content taller than one A4 page
  // (relevant for transcripts, or a report card that overflows slightly)
  while (heightLeft > 0) {
    position = heightLeft - imgHeight
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight
  }

  void firstPageOfThisNode
}

// Builds one combined, print-ready PDF from an ordered list of DOM nodes —
// each node (e.g. one student's report card) starts on its own fresh page.
// Used for the bulk "whole class at once" generation flow.
export async function combineNodesToPdf(nodes: HTMLElement[]): Promise<jsPDF> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  for (let i = 0; i < nodes.length; i++) {
    await drawNodeIntoPdf(pdf, nodes[i], { startNewPage: i > 0 })
  }
  return pdf
}

// Renders a single node to its own standalone PDF and returns it as a Blob
// (rather than triggering a save), so callers like the bulk zip export can
// pack many per-student PDFs into one archive.
export async function nodeToPdfBlob(node: HTMLElement): Promise<Blob> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  await drawNodeIntoPdf(pdf, node, { startNewPage: false })
  return pdf.output('blob')
}
