from evidence import _mask


def test_sensitive_evidence_is_hashed():
    assert _mask("patient_id", "P001").startswith("sha256:")
    assert _mask("status", "VALID") == "VALID"
