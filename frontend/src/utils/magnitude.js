export const MINIMUM_DISPLAY_MAGNITUDE_MAXIMUM = 6;

export const getDisplayMagnitudeMaximum = (actualCatalogueMaximum) =>
  Math.max(
    MINIMUM_DISPLAY_MAGNITUDE_MAXIMUM,
    Math.ceil(Number.isFinite(actualCatalogueMaximum) ? actualCatalogueMaximum : 0),
  );

export const getCatalogueDisplayMagnitudeMaximum = (earthquakes) => {
  const actualCatalogueMaximum = earthquakes.reduce((maximum, earthquake) => {
    const magnitude = Number(earthquake?.Mw_mean);
    return Number.isFinite(magnitude) ? Math.max(maximum, magnitude) : maximum;
  }, Number.NEGATIVE_INFINITY);

  return getDisplayMagnitudeMaximum(actualCatalogueMaximum);
};

export const formatMagnitude = (value) => {
  const magnitude = Number(value);
  if (!Number.isFinite(magnitude)) return "—";
  return Number.isInteger(magnitude) ? magnitude.toFixed(1) : String(magnitude);
};
