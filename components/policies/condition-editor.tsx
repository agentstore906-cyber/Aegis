"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Input, Select, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { CONDITION_OPERATORS } from "@/lib/validation/policy";
import type { ConditionOperator } from "@prisma/client";

export type EditableCondition = {
  field: string;
  operator: ConditionOperator;
  /** Raw text as typed; converted to the right JSON shape on submit. */
  rawValue: string;
};

const NUMERIC_OPERATORS = new Set<ConditionOperator>([
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
]);
const LIST_OPERATORS = new Set<ConditionOperator>(["IN", "NOT_IN"]);

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  EQUALS: "equals",
  NOT_EQUALS: "does not equal",
  GREATER_THAN: "is greater than",
  GREATER_THAN_OR_EQUAL: "is at least",
  LESS_THAN: "is less than",
  LESS_THAN_OR_EQUAL: "is at most",
  IN: "is one of",
  NOT_IN: "is not one of",
  EXISTS: "is present",
};

export function conditionsToJsonValue(conditions: EditableCondition[]) {
  return conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: LIST_OPERATORS.has(c.operator)
      ? c.rawValue.split(",").map((v) => v.trim()).filter(Boolean)
      : c.operator === "EXISTS"
        ? true
        : NUMERIC_OPERATORS.has(c.operator)
          ? Number(c.rawValue)
          : c.rawValue,
  }));
}

export function ConditionEditor({
  initial,
  onChange,
}: {
  initial: EditableCondition[];
  onChange: (conditions: EditableCondition[]) => void;
}) {
  const [conditions, setConditions] = useState<EditableCondition[]>(initial);

  function update(next: EditableCondition[]) {
    setConditions(next);
    onChange(next);
  }

  function addCondition() {
    update([...conditions, { field: "context.amount", operator: "GREATER_THAN", rawValue: "" }]);
  }

  function removeCondition(index: number) {
    update(conditions.filter((_, i) => i !== index));
  }

  function updateCondition(index: number, patch: Partial<EditableCondition>) {
    update(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  return (
    <div>
      <input type="hidden" name="conditionsJson" value={JSON.stringify(conditionsToJsonValue(conditions))} readOnly />

      {conditions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No conditions — this policy matches on scope alone.
        </p>
      ) : (
        <div className="space-y-3">
          {conditions.map((condition, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
              <div className="min-w-40 flex-1">
                <Label htmlFor={`cond-field-${index}`} className="text-xs">
                  Field
                </Label>
                <Input
                  id={`cond-field-${index}`}
                  value={condition.field}
                  placeholder="context.amount"
                  onChange={(e) => updateCondition(index, { field: e.target.value })}
                />
              </div>
              <div className="min-w-44">
                <Label htmlFor={`cond-op-${index}`} className="text-xs">
                  Operator
                </Label>
                <Select
                  id={`cond-op-${index}`}
                  value={condition.operator}
                  onChange={(e) => updateCondition(index, { operator: e.target.value as ConditionOperator })}
                >
                  {CONDITION_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABEL[op]}
                    </option>
                  ))}
                </Select>
              </div>
              {condition.operator !== "EXISTS" && (
                <div className="min-w-32 flex-1">
                  <Label htmlFor={`cond-value-${index}`} className="text-xs">
                    Value
                  </Label>
                  <Input
                    id={`cond-value-${index}`}
                    type={NUMERIC_OPERATORS.has(condition.operator) ? "number" : "text"}
                    value={condition.rawValue}
                    placeholder={LIST_OPERATORS.has(condition.operator) ? "gold, platinum" : "500"}
                    onChange={(e) => updateCondition(index, { rawValue: e.target.value })}
                  />
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Remove condition"
                onClick={() => removeCondition(index)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={addCondition}>
        <Plus className="size-3.5" aria-hidden="true" />
        Add condition
      </Button>
    </div>
  );
}
