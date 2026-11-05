import { useId } from 'react';
import { PRESET_LABELS, presetRange, type DateRange, type PresetKey } from '../lib/dates';

export function DateRangeFields({
  value,
  onChange,
  presets,
  legend = 'Date range',
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  presets: PresetKey[];
  legend?: string;
}) {
  const id = useId();
  const active = presets.find((p) => {
    const r = presetRange(p);
    return r.from === value.from && r.to === value.to;
  });
  const invalid = value.from && value.to && value.from > value.to;
  return (
    <fieldset className="date-range">
      <legend>{legend}</legend>
      <div className="chip-row" role="group" aria-label={`${legend} presets`}>
        {presets.map((p) => (
          <button
            type="button"
            key={p}
            className={`chip ${active === p ? 'chip-active' : ''}`}
            aria-pressed={active === p}
            onClick={() => onChange(presetRange(p))}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="range-inputs">
        <label htmlFor={`${id}-from`}>
          <span>From</span>
          <input id={`${id}-from`} type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        </label>
        <label htmlFor={`${id}-to`}>
          <span>To</span>
          <input id={`${id}-to`} type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </label>
      </div>
      {invalid && <p className="field-error">"From" must be on or before "To".</p>}
    </fieldset>
  );
}
