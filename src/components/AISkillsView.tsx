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

import { useState } from "react";
import {
  Sparkles,
  Search,
  Plus,
  Trash2,
  Shield,
  Layers,
  ChevronDown,
  ChevronUp,
  Check,
  FileCode,
  X,
} from "lucide-react";
import {
  useSkills,
  useSessionSkillToggles,
  setSkillToggle,
  installSkill,
  removeSkill,
  parseSkillMd,
  type SkillToggle,
} from "../lib/aiSkills";

export default function AISkillsView() {
  const skills = useSkills();
  const toggles = useSessionSkillToggles();
  const [query, setQuery] = useState("");
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importContent, setImportContent] = useState("");
  const [importError, setImportError] = useState("");

  const filtered = skills.filter((s) => {
    const q = query.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  function handleImport() {
    setImportError("");
    if (!importContent.trim()) {
      setImportError("Please paste SKILL.md content.");
      return;
    }
    try {
      const parsed = parseSkillMd(importContent);
      installSkill(parsed);
      setImporting(false);
      setImportContent("");
    } catch (e) {
      setImportError(`Failed to parse SKILL.md: ${String(e)}`);
    }
  }

  return (
    <div className="ai-skills-view">
      <div className="ai-skills-header">
        <div className="ai-skills-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skill library…"
            aria-label="Search skills"
          />
        </div>
        <button
          className="setting-action"
          onClick={() => setImporting(!importing)}
          title="Import or create a custom SKILL.md"
        >
          <Plus size={13} /> Add Skill
        </button>
      </div>

      {importing && (
        <div className="ai-skill-import-modal">
          <div className="ai-skill-import-header">
            <strong>Import SKILL.md</strong>
            <button
              className="icon-button"
              onClick={() => setImporting(false)}
              aria-label="Close import"
            >
              <X size={14} />
            </button>
          </div>
          <p className="muted">
            Paste the contents of an official <code>SKILL.md</code> file with frontmatter metadata and instructions.
          </p>
          <textarea
            value={importContent}
            onChange={(e) => setImportContent(e.target.value)}
            placeholder={`---
name: my-custom-skill
title: Custom Framework Helper
description: Provides guidelines for building internal microservices
version: 1.0.0
permissions:
  - read_file
  - write_file
dependencies:
  - node
---

### Instructions
- Follow repository patterns...`}
            rows={8}
            className="ai-skill-textarea"
          />
          {importError && <p className="ai-error">{importError}</p>}
          <div className="ai-skill-import-actions">
            <button className="primary" onClick={handleImport}>
              <Check size={13} /> Install Skill
            </button>
            <button className="secondary" onClick={() => setImporting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="ai-skills-list">
        {filtered.map((skill) => {
          const currentToggle: SkillToggle =
            toggles[skill.id] ?? skill.toggle ?? "auto";
          const isExpanded = expandedSkill === skill.id;

          return (
            <div
              key={skill.id}
              className={`ai-skill-card ${!skill.installed ? "uninstalled" : ""}`}
            >
              <div className="ai-skill-card-top">
                <div className="ai-skill-info">
                  <div className="ai-skill-title-row">
                    <Sparkles size={14} className="ai-skill-icon" />
                    <strong>{skill.title}</strong>
                    <span className="ai-skill-version">v{skill.version}</span>
                    <span className={`ai-skill-source-badge ${skill.source}`}>
                      {skill.source}
                    </span>
                  </div>
                  <p className="ai-skill-desc">{skill.description}</p>
                  <div className="ai-skill-tags">
                    {skill.tags.map((t) => (
                      <span key={t} className="ai-skill-tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Skill Toggles: Auto / On / Off */}
                <div className="ai-skill-toggles-container">
                  <span className="ai-skill-toggle-label">Mode:</span>
                  <div className="ai-skill-toggle-group">
                    {(["auto", "on", "off"] as SkillToggle[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`ai-skill-toggle-btn ${currentToggle === mode ? "active " + mode : ""}`}
                        onClick={() => setSkillToggle(skill.id, mode)}
                        title={`Set ${skill.title} to ${mode.toUpperCase()}`}
                      >
                        {mode.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Collapsible Details */}
              <div className="ai-skill-card-actions">
                <button
                  type="button"
                  className="ai-skill-expand-btn"
                  onClick={() =>
                    setExpandedSkill(isExpanded ? null : skill.id)
                  }
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp size={12} /> Hide details & permissions
                    </>
                  ) : (
                    <>
                      <ChevronDown size={12} /> View details & permissions
                    </>
                  )}
                </button>

                {skill.source !== "builtin" && (
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => removeSkill(skill.id)}
                    title="Remove skill"
                    aria-label="Remove skill"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {isExpanded && (
                <div className="ai-skill-details">
                  {skill.permissions.length > 0 && (
                    <div className="ai-skill-detail-section">
                      <span className="ai-skill-detail-title">
                        <Shield size={12} /> Required Permissions:
                      </span>
                      <div className="ai-skill-perm-list">
                        {skill.permissions.map((p) => (
                          <span key={p} className="ai-skill-perm-item">
                            <code>{p}</code>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {skill.dependencies.length > 0 && (
                    <div className="ai-skill-detail-section">
                      <span className="ai-skill-detail-title">
                        <Layers size={12} /> Dependencies:
                      </span>
                      <div className="ai-skill-perm-list">
                        {skill.dependencies.map((d) => (
                          <span key={d} className="ai-skill-perm-item">
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="ai-skill-detail-section">
                    <span className="ai-skill-detail-title">
                      <FileCode size={12} /> Skill Instructions:
                    </span>
                    <pre className="ai-skill-content-pre">
                      {skill.content}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
