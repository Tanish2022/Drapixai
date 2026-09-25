#!/usr/bin/env python3
"""Strictly verify a numeric `ss -H -lnt` snapshot received on stdin."""

import ipaddress
import os
import re
import sys


DEFAULT_PORTS = "5432,6379,8080,9000,9001,13000,18000,18080"
PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "fc00::/7")
)


def parse_port(value, allow_zero=False):
    if not re.fullmatch(r"0|[1-9][0-9]{0,4}", value):
        raise ValueError("expected a numeric TCP port without leading zeros")
    number = int(value)
    if not (0 if allow_zero else 1) <= number <= 65535:
        raise ValueError("TCP port is out of range")
    return number


def normalize_ip(address):
    # IPv4-mapped IPv6 binds have the same exposure as the embedded IPv4 bind.
    return getattr(address, "ipv4_mapped", None) or address


def read_policy():
    ports = [parse_port(port.strip()) for port in os.environ.get("DRAPIXAI_PRIVATE_PORTS", DEFAULT_PORTS).split(",")]
    if len(set(ports)) != len(ports):
        raise ValueError("DRAPIXAI_PRIVATE_PORTS contains duplicate ports")
    allowed = set()
    value = os.environ.get("DRAPIXAI_PRIVATE_BIND_IPS", "")
    if value:
        for entry in value.split(","):
            literal = entry.strip()
            if not literal or "%" in literal:
                raise ValueError("DRAPIXAI_PRIVATE_BIND_IPS requires exact unscoped IP literals")
            address = normalize_ip(ipaddress.ip_address(literal))
            # is_private alone includes reserved/documentation ranges in some
            # Python versions. Only these explicit private ranges can be
            # authorized; no public or wildcard exception is supported.
            if not any(address in network for network in PRIVATE_NETWORKS):
                raise ValueError("DRAPIXAI_PRIVATE_BIND_IPS permits only RFC1918, CGNAT or ULA addresses")
            allowed.add(address)
    return ports, allowed


def parse_endpoint(value, peer=False):
    address_text, separator, port_text = value.rpartition(":")
    if not separator or not address_text:
        raise ValueError("missing address or port")
    port = None if peer and port_text == "*" else parse_port(port_text, allow_zero=peer)
    if address_text == "*":
        return None, port
    if address_text.startswith("["):
        if not address_text.endswith("]") or ":" not in address_text:
            raise ValueError("invalid bracketed IPv6 endpoint")
        address_text = address_text[1:-1]
    if "[" in address_text or "]" in address_text:
        raise ValueError("invalid endpoint brackets")
    if "%" in address_text:
        address_text, scope = address_text.split("%", 1)
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", scope):
            raise ValueError("invalid interface scope")
    return normalize_ip(ipaddress.ip_address(address_text)), port


def read_snapshot(snapshot):
    listeners = []
    for line_number, line in enumerate(snapshot.splitlines(), 1):
        if not line.strip():
            continue
        fields = line.split()
        try:
            if len(fields) != 5 or fields[0] != "LISTEN":
                raise ValueError("expected five fields from ss -H -lnt")
            if not all(re.fullmatch(r"[0-9]+", field) for field in fields[1:3]):
                raise ValueError("invalid queue counters")
            address, port = parse_endpoint(fields[3])
            parse_endpoint(fields[4], peer=True)
        except ValueError as error:
            raise ValueError("invalid ss row {}: {}".format(line_number, error)) from error
        listeners.append((address, port))
    return listeners


def main():
    try:
        ports, allowed = read_policy()
        listeners = read_snapshot(sys.stdin.read())
    except ValueError as error:
        print("ERROR: private listener verification could not complete: {}".format(error), file=sys.stderr)
        return 2

    failures = [
        (address, port)
        for address, port in listeners
        if port in ports and (address is None or not (address.is_loopback or address in allowed))
    ]
    if failures:
        for address, port in failures:
            print("FAIL: protected port {} is bound to unapproved address {}.".format(port, address or "*"), file=sys.stderr)
        return 1

    for port in ports:
        if any(bound_port == port for _, bound_port in listeners):
            print("PASS: port {} binds only to loopback or explicitly approved private IPs.".format(port))
        else:
            print("PASS: no host TCP listener on port {} in this snapshot.".format(port))
    print("Host TCP listener verification passed. Verify container forwarding, firewall rules and VPN ACLs separately.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
