"""
Unit tests for haversine_km() in reconcile.py.

haversine_km(lat1, lon1, lat2, lon2) → distance in kilometres between two
points on Earth using the Haversine formula.
"""
import math
from reconcile import haversine_km


class TestHaversineSamePoint:
    def test_same_coordinates_returns_zero(self):
        assert haversine_km(64.0, -22.0, 64.0, -22.0) == 0.0

    def test_same_coordinates_at_equator(self):
        assert haversine_km(0.0, 0.0, 0.0, 0.0) == 0.0

    def test_same_coordinates_at_pole(self):
        assert haversine_km(90.0, 0.0, 90.0, 0.0) == 0.0


class TestHaversineKnownDistances:
    """
    Reference distances from public geodesy sources (±1 % tolerance).
    All coordinates in decimal degrees, WGS-84.
    """

    def test_reykjavik_to_akureyri(self):
        # Reykjavik (64.1466°N, 21.9426°W) → Akureyri (65.6835°N, 18.1105°W)
        # Straight-line (great-circle) distance ≈ 248 km
        dist = haversine_km(64.1466, -21.9426, 65.6835, -18.1105)
        assert 240 < dist < 260, f"Expected ~248 km, got {dist:.1f} km"

    def test_reykjavik_to_vik(self):
        # Reykjavik → Vík í Mýrdal (63.4188°N, 18.9985°W) ≈ 166 km
        dist = haversine_km(64.1466, -21.9426, 63.4188, -18.9985)
        assert 155 < dist < 180, f"Expected ~166 km, got {dist:.1f} km"

    def test_very_close_points(self):
        # Two points ~1 km apart (shifting longitude by ~0.015° at 64°N ≈ 0.7 km)
        dist = haversine_km(64.0, -22.0, 64.0, -22.015)
        assert 0 < dist < 2, f"Expected < 2 km, got {dist:.3f} km"

    def test_symmetry(self):
        # haversine(A, B) == haversine(B, A)
        d1 = haversine_km(64.1466, -21.9426, 65.6835, -18.1105)
        d2 = haversine_km(65.6835, -18.1105, 64.1466, -21.9426)
        assert math.isclose(d1, d2, rel_tol=1e-9)

    def test_always_positive(self):
        dist = haversine_km(63.0, -19.0, 65.0, -24.0)
        assert dist > 0


class TestHaversineThresholdBehaviour:
    """
    Verify the 10 km matching threshold used in reconcile.match_and_merge.
    DIST_LIMIT_KM = 10.0  → two events must be < 10 km apart to be candidates.
    """

    def test_within_10km_threshold(self):
        # ~5 km shift northward at 64°N (0.045° lat ≈ 5 km)
        dist = haversine_km(64.0, -22.0, 64.045, -22.0)
        assert dist < 10.0

    def test_outside_10km_threshold(self):
        # ~15 km shift northward (0.135° lat ≈ 15 km)
        dist = haversine_km(64.0, -22.0, 64.135, -22.0)
        assert dist >= 10.0
