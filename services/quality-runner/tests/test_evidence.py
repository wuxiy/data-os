from evidence import _mask


def test_sensitive_evidence_is_hashed():
    assert _mask("patient_id", "P001").startswith("sha256:")
    assert _mask("status", "VALID") == "VALID"


def test_unlisted_fields_are_redacted_and_identifiers_use_hmac():
    assert _mask("diagnosis_text", "should not be copied", "REDACTED", "tenant-key-123456") == "[REDACTED]"
    assert _mask("patient_id", "P001", "IDENTIFIER", "tenant-key-123456").startswith("hmac-sha256:")
