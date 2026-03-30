import DOMPurify from "dompurify";

export const FILE_PATH_PATTERN = /\.(txt|md|markdown)$/i;

const BLOCK_TEXT_TAGS = new Set([
  "DIV",
  "P",
  "LI",
  "TR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "TABLE",
]);

const ALLOWED_EDITOR_TAGS = [
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "b",
  "u",
  "ul",
];

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/\u00a0/g, " ");
}

export function ensureTextFileExtension(path: string, fallbackExtension = ".txt"): string {
  const trimmed = path.trim();
  if (!trimmed) return fallbackExtension;
  return FILE_PATH_PATTERN.test(trimmed) ? trimmed : `${trimmed}${fallbackExtension}`;
}

export function sanitizeEditorHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_EDITOR_TAGS,
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["class", "style"],
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  });
  const container = document.createElement("div");
  container.innerHTML = typeof sanitized === "string" ? sanitized : String(sanitized);
  container.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "class" || name === "style") {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return container.innerHTML;
}

export function replaceTextInHtml(
  html: string,
  query: string,
  replacement: string,
  mode: "one" | "all",
): string {
  const trimmed = query.trim();
  if (!trimmed) return sanitizeEditorHtml(html);

  const container = document.createElement("div");
  container.innerHTML = sanitizeEditorHtml(html);
  const regex = new RegExp(escapeRegex(trimmed), mode === "all" ? "gi" : "i");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? "";
    if (!regex.test(text)) {
      regex.lastIndex = 0;
      continue;
    }
    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      fragment.appendChild(document.createTextNode(replacement));
      lastIndex = end;
      if (mode === "one") break;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
    if (mode === "one") break;
  }

  return sanitizeEditorHtml(container.innerHTML);
}

export function nodeToPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return "";
  }

  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "BR") {
    return "\n";
  }

  let text = "";
  node.childNodes.forEach((child) => {
    text += nodeToPlainText(child);
  });

  if (
    node.nodeType === Node.ELEMENT_NODE &&
    BLOCK_TEXT_TAGS.has((node as Element).tagName) &&
    !text.endsWith("\n")
  ) {
    text += "\n";
  }

  return text;
}

export function textToHtml(text: string): string {
  const normalizedText = normalizePlainText(text);
  const div = document.createElement("div");
  div.textContent = normalizedText;
  return div.innerHTML.replace(/\n/g, "<br>");
}

export function normalizeHtml(content: string): string {
  const safeContent = /<[^>]+>/.test(content) ? content : textToHtml(content);
  return sanitizeEditorHtml(safeContent);
}

export function sanitizedHtmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return normalizePlainText(nodeToPlainText(div));
}

export function htmlToText(html: string): string {
  return sanitizedHtmlToText(sanitizeEditorHtml(html));
}

export function stripSearchHighlights(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = sanitizeEditorHtml(html);
  container.querySelectorAll("mark.search-hit").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
  return sanitizeEditorHtml(container.innerHTML);
}
