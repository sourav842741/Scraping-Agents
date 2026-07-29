/** Searchable location presets (LinkedIn `location` / Indeed `l`). */
export const LOCATION_GROUPS = [
  {
    label: "Remote & flexible",
    items: [
      "Remote",
      "Work from home",
      "United States (Remote)",
      "India (Remote)",
      "United Kingdom (Remote)",
    ],
  },
  {
    label: "Countries & regions",
    items: [
      "United States",
      "India",
      "United Kingdom",
      "Canada",
      "Australia",
      "Germany",
      "Singapore",
      "United Arab Emirates",
      "Worldwide",
    ],
  },
  {
    label: "United States — cities",
    items: [
      "New York, NY",
      "San Francisco, CA",
      "Los Angeles, CA",
      "Seattle, WA",
      "Austin, TX",
      "Boston, MA",
      "Chicago, IL",
      "Denver, CO",
      "Atlanta, GA",
      "Dallas, TX",
      "Miami, FL",
      "Washington, DC",
      "San Jose, CA",
      "Portland, OR",
      "Philadelphia, PA",
    ],
  },
  {
    label: "India — cities",
    items: [
      "Bengaluru, Karnataka",
      "Hyderabad, Telangana",
      "Pune, Maharashtra",
      "Mumbai, Maharashtra",
      "Chennai, Tamil Nadu",
      "Delhi, India",
      "Gurugram, Haryana",
      "Noida, Uttar Pradesh",
      "Kolkata, West Bengal",
    ],
  },
  {
    label: "Europe & other",
    items: [
      "London, UK",
      "Berlin, Germany",
      "Amsterdam, Netherlands",
      "Paris, France",
      "Toronto, ON",
      "Sydney, Australia",
      "Dubai, United Arab Emirates",
    ],
  },
];

export const ALL_LOCATIONS = LOCATION_GROUPS.flatMap((g) =>
  g.items.map((value) => ({ value, group: g.label }))
);

export function filterLocations(query) {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_LOCATIONS.slice(0, 40);
  return ALL_LOCATIONS.filter(
    (loc) =>
      loc.value.toLowerCase().includes(q) ||
      loc.group.toLowerCase().includes(q)
  ).slice(0, 30);
}
