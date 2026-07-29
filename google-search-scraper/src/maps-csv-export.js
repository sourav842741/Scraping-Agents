function escapeCsv(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function mapsResultsToCsv(results = []) {
  const headers = [
    "position",
    "name",
    "category",
    "rating",
    "reviewCount",
    "address",
    "phone",
    "status",
    "mapsUrl",
    "scrollRound",
    "searchQuery",
  ];

  const rows = results.map((r) =>
    [
      r.position,
      r.name,
      r.category,
      r.rating,
      r.reviewCount,
      r.address,
      r.phone,
      r.status,
      r.mapsUrl,
      r.scrollRound,
      r.searchQuery ?? "",
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
