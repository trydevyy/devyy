// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useExtensions, type InstalledExtension } from "../lib/extensions";
import { hostRequest } from "../lib/extensionHost";
import Select from "./ui/Select";
interface Property {
  type?: string | string[];
  default?: unknown;
  enum?: unknown[];
  description?: string;
  markdownDescription?: string;
  minimum?: number;
  maximum?: number;
}
export function matchingExtensionSettings(
  extensions: InstalledExtension[],
  query: string,
) {
  const owner = /@ext:([^\s]+)/i.exec(query)?.[1].toLowerCase();
  const terms = query
    .replace(/@ext:[^\s]+/gi, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return extensions.flatMap((extension) => {
    if (owner && extension.id.toLowerCase() !== owner) return [];
    const configuration = extension.contributes.configuration;
    return (
      Array.isArray(configuration) ? configuration : [configuration]
    ).flatMap((section) => {
      const properties =
        (section as { properties?: Record<string, Property> } | undefined)
          ?.properties ?? {};
      return Object.entries(properties)
        .filter(([key, property]) =>
          terms.every((term) =>
            `${extension.id} ${extension.name} ${key} ${property.description ?? property.markdownDescription ?? ""}`
              .toLowerCase()
              .includes(term),
          ),
        )
        .map(([key, property]) => ({ key, property, extension }));
    });
  });
}
export default function ExtensionConfiguration({ query }: { query: string }) {
  const extensions = useExtensions();
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => {
    let current = true;
    void hostRequest<Record<string, unknown>>("readConfiguration")
      .then((result) => {
        if (current) setValues(result ?? {});
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  const owner = /@ext:([^\s]+)/i.test(query);
  const settings = matchingExtensionSettings(extensions, query);
  if (!settings.length)
    return owner ? (
      <p className="muted">
        This extension does not declare settings. Use its own settings command
        or configuration file.
      </p>
    ) : null;
  return (
    <section
      className="extension-configuration"
      aria-label="Extension settings"
    >
      {settings.map(({ key, property, extension }) => (
        <Setting
          key={key}
          name={key}
          property={property}
          owner={extension.name}
          value={Object.hasOwn(values, key) ? values[key] : property.default}
          onSave={async (value, reset = false) => {
            await hostRequest("updateConfiguration", { key, value, reset });
            setValues((old) => ({
              ...old,
              [key]: reset ? property.default : value,
            }));
          }}
        />
      ))}
    </section>
  );
}
function Setting({
  name,
  owner,
  property,
  value,
  onSave,
}: {
  name: string;
  owner: string;
  property: Property;
  value: unknown;
  onSave: (value: unknown, reset?: boolean) => Promise<void>;
}) {
  const serialize = (value: unknown) =>
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  const [draft, setDraft] = useState(() => serialize(value));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(serialize(value)), [value]);
  const save = async (value: unknown, reset = false) => {
    setBusy(true);
    try {
      await onSave(value, reset);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  const numeric = property.type === "number" || property.type === "integer";
  return (
    <article className="extension-setting">
      <header>
        <label htmlFor={`ext-setting-${name}`}>{name}</label>
        <button
          title={`Reset ${name}`}
          aria-label={`Reset ${name}`}
          disabled={busy}
          onClick={() => void save(undefined, true)}
        >
          <RotateCcw size={13} />
        </button>
      </header>
      <small>{owner}</small>
      <p>{property.description ?? property.markdownDescription}</p>
      {property.type === "boolean" ? (
        <button
          id={`ext-setting-${name}`}
          role="switch"
          aria-checked={!!value}
          aria-label={name}
          className={`switch ${value ? "on" : ""}`}
          disabled={busy}
          onClick={() => void save(!value)}
        >
          <span />
        </button>
      ) : property.enum ? (
        <Select
          id={`ext-setting-${name}`}
          aria-label={name}
          value={JSON.stringify(value) ?? ""}
          disabled={busy}
          onChange={(event) => void save(JSON.parse(event.target.value))}
        >
          {property.enum.map((option) => (
            <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
              {String(option)}
            </option>
          ))}
        </Select>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const parsed = numeric
                ? Number(draft)
                : property.type === "string"
                  ? draft
                  : JSON.parse(draft);
              if (
                numeric &&
                (!draft.trim() ||
                  !Number.isFinite(parsed) ||
                  (property.type === "integer" && !Number.isInteger(parsed)) ||
                  (property.minimum !== undefined &&
                    parsed < property.minimum) ||
                  (property.maximum !== undefined && parsed > property.maximum))
              )
                throw Error("Enter a number within the setting's limits.");
              void save(parsed);
            } catch (error) {
              toast.error(String(error));
            }
          }}
        >
          {property.type === "string" || numeric ? (
            <input
              id={`ext-setting-${name}`}
              className="text-input"
              type={numeric ? "number" : "text"}
              min={property.minimum}
              max={property.maximum}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={name}
            />
          ) : (
            <textarea
              id={`ext-setting-${name}`}
              className="text-input mono"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={name}
            />
          )}
          <button
            className="setting-action"
            disabled={busy || draft === serialize(value)}
            type="submit"
          >
            Save
          </button>
        </form>
      )}
    </article>
  );
}
