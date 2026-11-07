from __future__ import annotations

import asyncio

import pytest

from canccu_kit.tenant import (
    NoTenant,
    current_tenant,
    is_tenant_id,
    platform_files_dir,
    platform_stream,
    require_tenant,
    tenant_file,
    tenant_files_dir,
    tenant_key,
    tenant_scope,
    tenant_stream,
)


def test_tenant_ids_accept_the_contracts_ids_and_refuse_the_rest() -> None:
    for ok in ["demo", "lan-2026", "a1b"]:
        assert is_tenant_id(ok)
    for bad in ["", "ab", "Demo", "1abc", "abc-", "_platform", "a:b", "a/b", "x" * 33, "abc\n"]:
        assert not is_tenant_id(bad)


def test_context_is_unset_outside_a_scope() -> None:
    assert current_tenant() is None
    with pytest.raises(NoTenant):
        require_tenant()


async def test_context_is_set_inside_a_scope_also_across_awaits_and_nests() -> None:
    with tenant_scope("demo"):
        await asyncio.sleep(0)
        assert require_tenant() == "demo"
        with tenant_scope("other"):
            assert current_tenant() == "other"
        assert current_tenant() == "demo"
    assert current_tenant() is None


async def test_a_task_started_in_a_scope_keeps_its_tenant() -> None:
    async def read() -> str | None:
        await asyncio.sleep(0)
        return current_tenant()

    with tenant_scope("demo"):
        task = asyncio.create_task(read())
    assert await task == "demo"


def test_scope_refuses_an_invalid_tenant_id() -> None:
    with pytest.raises(ValueError, match="tenant id"), tenant_scope("../x"):
        pass


def test_names_tenant_and_platform_streams() -> None:
    assert tenant_stream("pizza", "demo") == "t:demo:events:pizza"
    with tenant_scope("demo"):
        assert tenant_stream("pizza") == "t:demo:events:pizza"
    assert platform_stream("tenants") == "events:tenants"
    with pytest.raises(NoTenant):
        tenant_stream("pizza")


def test_builds_valkey_keys_from_the_current_tenant_only() -> None:
    with tenant_scope("demo"):
        assert tenant_key("pizza", "cache", "menu") == "t:demo:pizza:cache:menu"
        with pytest.raises(ValueError, match="at least one"):
            tenant_key("pizza")
        for bad in ["a:b", "", "a b"]:
            with pytest.raises(ValueError, match="part"):
                tenant_key("pizza", bad)
    with pytest.raises(NoTenant):
        tenant_key("pizza", "cache")


def test_puts_files_under_the_tenant_tree_and_refuses_escapes() -> None:
    with tenant_scope("demo"):
        assert tenant_files_dir("pizza") == "/files/demo/pizza/"
        assert tenant_file("pizza", "menus/a.png") == "/files/demo/pizza/menus/a.png"
        assert tenant_file("pizza", "a.png", "/tmp/f") == "/tmp/f/demo/pizza/a.png"
        for bad in ["../x", "a/../../x", "/etc/passwd", "", "a\0b", "a\\b"]:
            with pytest.raises(ValueError, match="file path"):
                tenant_file("pizza", bad)
    with pytest.raises(NoTenant):
        tenant_file("pizza", "a.png")
    assert platform_files_dir("tenants") == "/files/_platform/tenants/"


def test_refuses_module_names_that_could_escape_a_key_or_path() -> None:
    with tenant_scope("demo"):
        with pytest.raises(ValueError, match="module"):
            tenant_files_dir("../x")
        with pytest.raises(ValueError, match="module"):
            tenant_key("a:b", "x")
        # t:<tenant>:events:<module> is a stream name, never a key.
        with pytest.raises(ValueError, match="stream"):
            tenant_key("events", "x")
