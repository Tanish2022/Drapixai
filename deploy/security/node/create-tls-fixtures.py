"""Synthetic one-day TLS fixtures for an isolated container smoke test."""
import datetime
import ipaddress
import sys
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

out = Path(sys.argv[1]).resolve()
if out.exists() and any(out.iterdir()):
    raise SystemExit('Refusing to overwrite TLS fixtures')
out.mkdir(parents=True, exist_ok=True)
now = datetime.datetime.now(datetime.timezone.utc)


def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def name(value):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, value)])


def ca(value):
    private = key()
    subject = name(value)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(private.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=5))
            .not_valid_after(now+datetime.timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .sign(private, hashes.SHA256()))
    return private, cert


authority, authority_cert = ca('Synthetic candidate CA')
_, other_cert = ca('Synthetic unrelated CA')
for label, cert in [('ca', authority_cert), ('other-ca', other_cert)]:
    (out/f'{label}.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
for label, purpose, expired in [('server', ExtendedKeyUsageOID.SERVER_AUTH, False),
                                ('client', ExtendedKeyUsageOID.CLIENT_AUTH, False),
                                ('expired-server', ExtendedKeyUsageOID.SERVER_AUTH, True)]:
    private = key()
    cert = (x509.CertificateBuilder().subject_name(name(f'Synthetic {label}')).issuer_name(authority_cert.subject)
            .public_key(private.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-datetime.timedelta(days=2))
            .not_valid_after(now+datetime.timedelta(days=-1 if expired else 1))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([purpose]), critical=False)
            .add_extension(x509.SubjectAlternativeName([x509.DNSName('candidate-server.example.test'),
                           x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
            .sign(authority, hashes.SHA256()))
    (out/f'{label}.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (out/f'{label}-key.pem').write_bytes(private.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
