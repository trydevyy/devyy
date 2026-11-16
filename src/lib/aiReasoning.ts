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

import type { AIModel } from "./ai";

export function effortLabel(value: string): string {
  if (value === "xhigh") return "Extra high";
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export function reasoningOptions(
  model?: AIModel,
): { id: string; label: string; description?: string }[] {
  const reported:
    { id: string; label: string; description?: string }[] | undefined = model
    ?.reasoningOptions?.length
    ? model.reasoningOptions
    : model?.reasoningEfforts
        ?.filter((id) => typeof id === "string")
        .map((id) => ({ id, label: effortLabel(id) }));
  return (reported ?? [])
    .filter(
      (option, index, all) =>
        option &&
        typeof option.id === "string" &&
        /^[A-Za-z0-9_-]{1,32}$/.test(option.id) &&
        all.findIndex((candidate) => candidate?.id === option.id) === index,
    )
    .map((option) => ({
      ...option,
      label:
        typeof option.label === "string" && option.label !== option.id
          ? option.label
          : effortLabel(option.id),
      description:
        typeof option.description === "string" ? option.description : undefined,
    }));
}
export function supportedEffort(
  model: AIModel | undefined,
  effort: string,
): string {
  return reasoningOptions(model).some((option) => option.id === effort)
    ? effort
    : "";
}
