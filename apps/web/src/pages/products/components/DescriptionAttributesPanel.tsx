/**
 * AiDescriptionSection — "Product Attributes" panel (presentational).
 * Extracted verbatim from AiGenerationPanel.tsx (no behaviour change): same
 * markup + dropdown wiring, moved behind props so the section file stays small.
 */

import { Tag, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AttributeDropdown, SearchableAttributeDropdown } from './AttributeDropdown';
import { ATTRIBUTE_ICONS, ATTRIBUTE_DROPDOWNS, DEFAULT_ATTRIBUTES } from './aiGeneration.constants';

export function DescriptionAttributesPanel({
  bulkAttrAction,
  acceptAllAttrs,
  unacceptAllAttrs,
  attrValues,
  setAttrValues,
  aiSuggestedAttrs,
  attrReviewMessages,
  acceptedAttrs,
  editingAttr,
  toggleAttr,
  startEditingAttr,
  stopEditingAttr,
}: {
  bulkAttrAction: 'accept' | 'unaccept' | 'none';
  acceptAllAttrs: () => void;
  unacceptAllAttrs: () => void;
  attrValues: Record<string, string>;
  setAttrValues: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  aiSuggestedAttrs: Record<string, string>;
  attrReviewMessages: Record<string, string>;
  acceptedAttrs: Set<string>;
  editingAttr: Record<string, boolean>;
  toggleAttr: (key: string) => void;
  startEditingAttr: (key: string) => void;
  stopEditingAttr: (key: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Product Attributes
        </p>
        <Button
          type="button"
          size="sm"
          variant={bulkAttrAction === 'unaccept' ? 'default' : 'outline'}
          className={cn(
            'h-6 px-2 text-[10px]',
            bulkAttrAction === 'unaccept' && 'bg-blue-600 hover:bg-blue-700 border-blue-600',
          )}
          onClick={() =>
            bulkAttrAction === 'accept'
              ? acceptAllAttrs()
              : bulkAttrAction === 'unaccept'
                ? unacceptAllAttrs()
                : undefined
          }
          disabled={bulkAttrAction === 'none'}
          title={
            bulkAttrAction === 'none'
              ? 'Set values for at least one attribute first'
              : bulkAttrAction === 'unaccept'
                ? 'Clear acceptance for all attributes that have values'
                : undefined
          }
        >
          {bulkAttrAction === 'unaccept' && <CheckCircle2 className="mr-1 h-3 w-3" />}
          {bulkAttrAction === 'unaccept' ? 'Unaccept All' : 'Accept All'}
        </Button>
      </div>
      {/* Attributes loaded from database dropdowns */}
      {(() => {
        return (
        <div className="space-y-1">
          {DEFAULT_ATTRIBUTES.map((attr) => {
            const Icon = ATTRIBUTE_ICONS[attr.key.toLowerCase()] ?? Tag;
            const accepted = acceptedAttrs.has(attr.key);
            const isEditing = editingAttr[attr.key];
            const dropdownConfig = ATTRIBUTE_DROPDOWNS[attr.key.toLowerCase()];
            const hasValue = !!(attrValues[attr.key]?.trim());

            return (
              <div
                key={attr.key}
                className={cn(
                  'flex items-center gap-2 rounded border px-2.5 py-1.5 transition-colors',
                  accepted ? 'border-blue-200 bg-blue-50/40' : 'border-border bg-background hover:bg-muted/20',
                )}
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] text-muted-foreground w-20 shrink-0">{attr.label}</span>

                {/* Use dropdown for configured attribute types, text input otherwise */}
                {dropdownConfig ? (
                  <div className="flex-1">
                    {dropdownConfig.searchable ? (
                      <SearchableAttributeDropdown
                        endpoint={dropdownConfig.endpoint}
                        idField={dropdownConfig.idField}
                        labelField={dropdownConfig.labelField}
                        value={attrValues[attr.key] ?? ''}
                        aiSuggestedValue={aiSuggestedAttrs[attr.key]}
                        reviewMessage={attrReviewMessages[attr.key]}
                        onChange={(_id, label) => {
                          // Populate the value only — the user must click Accept
                          // explicitly (auto-accept removed per UX direction).
                          setAttrValues((prev) => ({ ...prev, [attr.key]: label }));
                        }}
                        placeholder={`Search ${attr.label.toLowerCase()}...`}
                      />
                    ) : (
                      <AttributeDropdown
                        endpoint={dropdownConfig.endpoint}
                        idField={dropdownConfig.idField}
                        labelField={dropdownConfig.labelField}
                        value={attrValues[attr.key] ?? ''}
                        aiSuggestedValue={aiSuggestedAttrs[attr.key]}
                        reviewMessage={attrReviewMessages[attr.key]}
                        onChange={(_id, label) => {
                          setAttrValues((prev) => ({ ...prev, [attr.key]: label }));
                        }}
                        placeholder={`Select ${attr.label.toLowerCase()}...`}
                      />
                    )}
                  </div>
                ) : isEditing ? (
                  <Input
                    autoFocus
                    value={attrValues[attr.key] ?? ''}
                    onChange={(e) => setAttrValues((prev) => ({ ...prev, [attr.key]: e.target.value }))}
                    onBlur={() => stopEditingAttr(attr.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter') stopEditingAttr(attr.key); }}
                    className="h-5 flex-1 px-1 py-0 text-[11px] border-0 border-b rounded-none focus-visible:ring-0"
                  />
                ) : (
                  <button
                    type="button"
                    className="text-[11px] font-medium flex-1 truncate text-left hover:text-primary"
                    onClick={() => startEditingAttr(attr.key)}
                    title="Click to edit"
                  >
                    {attrValues[attr.key] ?? attr.value}
                  </button>
                )}

                {attr.confidence !== undefined && (
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    {Math.round(attr.confidence)}%
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={accepted ? 'default' : 'outline'}
                  disabled={!hasValue && !accepted}
                  title={!hasValue && !accepted ? 'Please select a value first' : undefined}
                  className={cn(
                    'h-5 px-2 text-[10px] shrink-0',
                    accepted && 'bg-blue-600 hover:bg-blue-700 border-blue-600',
                  )}
                  onClick={() => toggleAttr(attr.key)}
                >
                  {accepted ? 'Accepted' : 'Accept'}
                </Button>
              </div>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}
