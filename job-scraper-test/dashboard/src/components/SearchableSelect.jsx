import { useEffect, useId, useRef, useState } from "react";
import { filterLocations } from "../lib/locations.js";

export default function SearchableSelect({
  label,
  value,
  onChange,
  disabled,
  placeholder = "Search location…",
  allowCustom = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const wrapRef = useRef(null);
  const listId = useId();

  const options = filterLocations(query);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (v) => {
    onChange(v);
    setQuery(v);
    setOpen(false);
  };

  const commitCustom = () => {
    if (allowCustom && query.trim()) {
      onChange(query.trim());
      setOpen(false);
    }
  };

  return (
    <div className="searchable-select field" ref={wrapRef}>
      {label && <label htmlFor={listId}>{label}</label>}
      <div className={`combo ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}>
        <input
          id={listId}
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => !disabled && setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value) onChange("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (options[0] && open) pick(options[0].value);
              else commitCustom();
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button
          type="button"
          className="combo-chevron"
          disabled={disabled}
          aria-label="Toggle locations"
          onClick={() => !disabled && setOpen((o) => !o)}
        >
          ▾
        </button>
        {open && !disabled && (
          <ul className="combo-list" role="listbox">
            {options.length === 0 ? (
              <li className="combo-empty">
                {allowCustom ? (
                  <button type="button" onClick={commitCustom}>
                    Use “{query.trim()}”
                  </button>
                ) : (
                  "No matches"
                )}
              </li>
            ) : (
              options.map((opt) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === opt.value}
                    className={value === opt.value ? "selected" : ""}
                    onClick={() => pick(opt.value)}
                  >
                    <span className="opt-value">{opt.value}</span>
                    <span className="opt-group">{opt.group}</span>
                  </button>
                </li>
              ))
            )}
            {allowCustom && query.trim() && !options.some((o) => o.value === query.trim()) && (
              <li className="combo-custom">
                <button type="button" onClick={commitCustom}>
                  Use custom: {query.trim()}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
