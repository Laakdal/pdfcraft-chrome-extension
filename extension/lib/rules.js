// declarativeNetRequest rules that send PDF navigations to the PdfCraft viewer.
//
// Third-party extensions can't register as Chrome's PDF MIME handler, so the extension redirects
// instead: a rule matches a top-level response whose Content-Type is PDF (response-header
// conditions, Chrome 128+) and redirects it to pdfcraft.html?file=<original URL>. The viewer
// then downloads the document itself. Responses sent as attachments are left to Chrome's download
// manager, as the user (or site) asked.

export const RULE_PDF_CONTENT_TYPE = 1;
export const RULE_PDF_OCTET_STREAM = 2;
/** Session allow rules for "open in Chrome's viewer" start here; one per tab. */
export const BYPASS_RULE_BASE = 1000;

const PDF_TYPES = ['application/pdf', 'application/pdf;*', 'application/x-pdf', 'application/x-pdf;*'];
const ATTACHMENT = [{ header: 'content-disposition', values: ['attachment*'] }];

/** The dynamic redirect rules for an extension whose base URL is `extensionBase` (ends with "/"). */
export function redirectRules(extensionBase, { octetStream = true } = {}) {
  const redirect = {
    type: 'redirect',
    redirect: { regexSubstitution: `${extensionBase}pdfcraft.html?file=\\0` },
  };
  const rules = [
    {
      id: RULE_PDF_CONTENT_TYPE,
      priority: 1,
      action: redirect,
      condition: {
        regexFilter: '^https?://.*',
        resourceTypes: ['main_frame'],
        // A POST response (a generated report, a form result) can't be downloaded again.
        requestMethods: ['get'],
        responseHeaders: [{ header: 'content-type', values: PDF_TYPES }],
        excludedResponseHeaders: ATTACHMENT,
      },
    },
  ];
  if (octetStream) {
    // Servers that mislabel PDFs as generic binary data: only when the path says .pdf.
    rules.push({
      id: RULE_PDF_OCTET_STREAM,
      priority: 1,
      action: redirect,
      condition: {
        regexFilter: '^https?://[^?#]*\\.[Pp][Dd][Ff]([?#].*)?$',
        resourceTypes: ['main_frame'],
        requestMethods: ['get'],
        responseHeaders: [{ header: 'content-type', values: ['application/octet-stream', 'application/octet-stream;*', 'binary/octet-stream', 'application/download'] }],
        excludedResponseHeaders: ATTACHMENT,
      },
    });
  }
  return rules;
}

/** A session rule that lets one tab's next top-level PDF load reach Chrome's own viewer. */
export function bypassRule(tabId) {
  return {
    id: BYPASS_RULE_BASE + tabId,
    priority: 10,
    action: { type: 'allow' },
    condition: { tabIds: [tabId], resourceTypes: ['main_frame'] },
  };
}
