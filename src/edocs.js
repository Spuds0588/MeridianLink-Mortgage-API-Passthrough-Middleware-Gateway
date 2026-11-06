/** EDocsService.asmx response parsing: document metadata and base64 PDF payloads. */
const tag = (xml, name) =>
  new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, "i").exec(xml)?.[1]?.trim() ?? null;

const parseDocumentList = (xml) => ({
  documents: [...xml.matchAll(/<(?:[\w.-]+:)?edoc\b([^>]*)\/?>/gi)]
    .map((match) => {
      const attrs = Object.fromEntries(
        [...match[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, key, value]) => [key.toLowerCase().split(":").pop(), value])
      );
      return {
        id: attrs.edocid ?? attrs.id ?? attrs.documentid ?? null,
        documentType: attrs.documenttype ?? attrs.type ?? null,
        fileName: attrs.filename ?? attrs.name ?? null,
        notes: attrs.notes ?? null,
        uploadedAt: attrs.uploadeddate ?? attrs.uploaddate ?? attrs.date ?? null
      };
    })
    .filter((doc) => doc.id)
});

const parseDocumentContent = (xml) => {
  const raw =
    tag(xml, "DownloadEdocsPdfByIdResult") ??
    tag(xml, "Document") ??
    tag(xml, "Pdf") ??
    tag(xml, "Data");
  return (raw || "").replace(/\s+/g, "") || null;
};

module.exports = { parseDocumentList, parseDocumentContent };
