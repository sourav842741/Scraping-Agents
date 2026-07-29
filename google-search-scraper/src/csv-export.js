function escapeCsv(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function resultsToCsv(results = []) {
  const headers = [
    "position",
    "title",
    "domain",
    "url",
    "snippet",
    "hasWebsite",
    "websiteType",
    "remarks",
    "page",
    "searchQuery",
  ];

  const rows = results.map((r) =>
    [
      r.position,
      r.title,
      r.domain,
      r.url,
      r.snippet,
      r.hasWebsite ? "yes" : "no",
      r.websiteType,
      r.remarks ?? "",
      r.page,
      r.searchQuery ?? "",
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
