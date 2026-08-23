// Server-driven temporary form. This component deliberately contains no
// business scenario, compliance rule, or fixed question: those arrive in the
// conversation response as `temporaryUI` and are rendered generically here.
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";

export type ServerTemporaryUI = {
  id: string;
  kind: "SHORT_FORM";
  title: string;
  description: string;
  submitLabel: string;
  fields: ServerTemporaryUIField[];
};

export type ServerTemporaryUIField = {
  id: string;
  label: string;
  type: "SINGLE_SELECT" | "SHORT_TEXT";
  required: boolean;
  placeholder?: string;
  options?: Array<{ id: string; label: string }>;
};

export function readServerTemporaryUI(value: unknown): ServerTemporaryUI | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "SHORT_FORM" || typeof candidate.id !== "string" || typeof candidate.title !== "string" || !Array.isArray(candidate.fields)) return undefined;
  const fields: ServerTemporaryUIField[] = [];
  for (const field of candidate.fields) {
    if (!field || typeof field !== "object") return undefined;
    const item = field as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.label !== "string" || (item.type !== "SINGLE_SELECT" && item.type !== "SHORT_TEXT") || typeof item.required !== "boolean") return undefined;
    const options = Array.isArray(item.options) ? item.options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const value = option as Record<string, unknown>;
      return typeof value.id === "string" && typeof value.label === "string" ? [{ id: value.id, label: value.label }] : [];
    }) : undefined;
    if (item.type === "SINGLE_SELECT" && !options?.length) return undefined;
    fields.push({ id: item.id, label: item.label, type: item.type, required: item.required, ...(typeof item.placeholder === "string" ? { placeholder: item.placeholder } : {}), ...(options ? { options } : {}) });
  }
  return {
    id: candidate.id,
    kind: "SHORT_FORM",
    title: candidate.title,
    description: typeof candidate.description === "string" ? candidate.description : "",
    submitLabel: typeof candidate.submitLabel === "string" && candidate.submitLabel ? candidate.submitLabel : "继续",
    fields
  };
}

export function ServerTemporaryForm({ spec, disabled, onSubmit }: { spec: ServerTemporaryUI; disabled?: boolean; onSubmit: (summary: string) => void }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => setValues({}), [spec.id]);
  const complete = useMemo(() => spec.fields.every((field) => !field.required || Boolean(values[field.id]?.trim())), [spec.fields, values]);

  function submit(): void {
    if (!complete || disabled) return;
    const summary = spec.fields
      .filter((field) => values[field.id]?.trim())
      .map((field) => `${field.label}：${values[field.id]?.trim() ?? ""}`)
      .join("；");
    onSubmit(summary);
  }

  return (
    <View style={styles.card} accessibilityLabel={spec.title}>
      <Text style={styles.title}>{spec.title}</Text>
      {spec.description ? <Text style={styles.description}>{spec.description}</Text> : null}
      {spec.fields.map((field) => (
        <View key={field.id} style={styles.field}>
          <Text style={styles.label}>{field.label}{field.required ? <Text style={styles.required}> · 必填</Text> : null}</Text>
          {field.type === "SINGLE_SELECT" ? (
            <View style={styles.options}>
              {field.options?.map((option) => {
                const selected = values[field.id] === option.label;
                return <Pressable key={option.id} disabled={disabled} onPress={() => setValues((current) => ({ ...current, [field.id]: option.label }))} style={[styles.option, selected && styles.optionSelected, disabled && styles.disabled]}><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text></Pressable>;
              })}
            </View>
          ) : (
            <TextInput
              editable={!disabled}
              onChangeText={(text) => setValues((current) => ({ ...current, [field.id]: text }))}
              placeholder={field.placeholder ?? "简短填写"}
              placeholderTextColor="#A9A2B0"
              style={styles.input}
              value={values[field.id] ?? ""}
            />
          )}
        </View>
      ))}
      <Pressable accessibilityLabel={spec.submitLabel} disabled={!complete || disabled} onPress={submit} style={[styles.submit, (!complete || disabled) && styles.disabled]}>
        <Text style={styles.submitText}>{spec.submitLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFF9FC", borderColor: "#F3C6D9", borderRadius: 16, borderWidth: 1, gap: 10, padding: 12 },
  title: { color: color.ink, fontSize: 12, fontWeight: "800" },
  description: { color: color.muted, fontSize: 11, lineHeight: 15 },
  field: { gap: 6 },
  label: { color: color.ink, fontSize: 11, fontWeight: "700" },
  required: { color: color.magenta, fontWeight: "600" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  option: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  optionSelected: { backgroundColor: "#FFE8F1", borderColor: color.magenta },
  optionText: { color: color.ink, fontSize: 11 },
  optionTextSelected: { color: color.magenta, fontWeight: "800" },
  input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, fontSize: 11, minHeight: 36, paddingHorizontal: 10, paddingVertical: 7 },
  submit: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 11, minHeight: 36, justifyContent: "center", marginTop: 2 },
  submitText: { color: color.white, fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.42 }
});
