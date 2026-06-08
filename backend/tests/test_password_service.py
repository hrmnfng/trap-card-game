"""Tests for password service."""

import pytest
from app.services.password import PasswordService


class TestPasswordService:
    """Test password hashing and verification."""

    def test_hash_password_returns_string(self):
        """Test that hash_password returns a string."""
        password = "123456"
        hashed = PasswordService.hash_password(password)
        
        assert isinstance(hashed, str)
        assert len(hashed) > 0

    def test_hash_password_creates_different_hashes(self):
        """Test that same password creates different hashes each time."""
        password = "123456"
        hash1 = PasswordService.hash_password(password)
        hash2 = PasswordService.hash_password(password)
        
        # Different hashes due to different salts
        assert hash1 != hash2
        # But both should verify successfully
        assert PasswordService.verify_password(password, hash1)
        assert PasswordService.verify_password(password, hash2)

    def test_verify_password_success(self):
        """Test verifying correct password."""
        password = "123456"
        hashed = PasswordService.hash_password(password)
        
        assert PasswordService.verify_password(password, hashed) is True

    def test_verify_password_failure_wrong_password(self):
        """Test verifying wrong password."""
        password = "123456"
        wrong_password = "654321"
        hashed = PasswordService.hash_password(password)
        
        assert PasswordService.verify_password(wrong_password, hashed) is False

    def test_verify_password_failure_empty_password(self):
        """Test verifying empty password."""
        password = "123456"
        hashed = PasswordService.hash_password(password)
        
        assert PasswordService.verify_password("", hashed) is False

    def test_hash_password_with_special_characters(self):
        """Test hashing password with special characters."""
        password = "pass@1234!"
        hashed = PasswordService.hash_password(password)
        
        assert PasswordService.verify_password(password, hashed) is True

    def test_hash_password_with_long_password(self):
        """Test hashing a longer password."""
        password = "this_is_a_very_long_password_123456"
        hashed = PasswordService.hash_password(password)
        
        assert PasswordService.verify_password(password, hashed) is True

    def test_verify_password_case_sensitive(self):
        """Test that password verification is case sensitive."""
        password = "MyPassword123"
        hashed = PasswordService.hash_password(password)
        
        assert PasswordService.verify_password("mypassword123", hashed) is False
