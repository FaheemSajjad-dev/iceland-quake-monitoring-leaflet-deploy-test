export const formatMagnitude = (value) => {
  const magnitude = Number(value);
  if (!Number.isFinite(magnitude)) return "—";
  return Number.isInteger(magnitude) ? magnitude.toFixed(1) : String(magnitude);
};
