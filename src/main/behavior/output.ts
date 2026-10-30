import { z } from 'zod';

/** Codex requires all object fields, using null for optional values. Keep the actual
 * decision validator authoritative; this schema prevents dropped required fields. */
export function structuredDecisionSchema(schema: z.ZodType) {
  const convert = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(convert);
    const result: any = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema').map(([key, item]) => [key, convert(item)]));
    if (result.type === 'object' && result.properties) {
      const required = new Set(result.required ?? []);
      for (const key of Object.keys(result.properties)) if (!required.has(key))
        result.properties[key] = { anyOf: [result.properties[key], { type: 'null' }] };
      result.required = Object.keys(result.properties); result.additionalProperties = false;
    }
    return result;
  };
  return convert(z.toJSONSchema(schema));
}

/** Null represents omission in the wire schema, except the explicitly nullable interest. */
export function omitOptionalNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitOptionalNulls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => item !== null || key === 'interest').map(([key, item]) => [key, omitOptionalNulls(item)]));
  return value;
}
