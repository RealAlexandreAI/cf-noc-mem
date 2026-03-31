async def test_read_memory_system_views(mcp_module, graph_service):
    await graph_service.create_memory(
        parent_path="",
        content="Agent identity",
        priority=1,
        title="agent",
        disclosure="When booting",
    )
    await graph_service.create_memory(
        parent_path="",
        content="User identity",
        priority=1,
        title="my_user",
        disclosure="When booting",
    )

    boot = await mcp_module.read_memory("system://boot")
    index_view = await mcp_module.read_memory("system://index/core")
    recent = await mcp_module.read_memory("system://recent/5")

    assert "core://agent" in boot
    assert "core://my_user" in boot
    assert "core://agent" in index_view
    assert "core://my_user" in recent


async def test_mcp_tool_flow_covers_crud_alias_triggers_and_search(mcp_module, graph_service):
    created = await mcp_module.create_memory(
        "core://",
        "Important Salem memory",
        priority=2,
        title="salem_note",
        disclosure="When testing MCP tools",
    )
    updated = await mcp_module.update_memory(
        "core://salem_note",
        append="\nGraphService handles aliases.",
    )
    triggers = await mcp_module.manage_triggers(
        "core://salem_note",
        add=["Salem"],
    )
    search = await mcp_module.search_memory("GraphService")
    alias = await mcp_module.add_alias(
        "project://salem_alias",
        "core://salem_note",
        priority=3,
        disclosure="When mirroring note",
    )
    deleted = await mcp_module.delete_memory("project://salem_alias")

    current = await graph_service.get_memory_by_path("salem_note", "core")
    removed_alias = await graph_service.get_memory_by_path("salem_alias", "project")

    assert "Success: Memory created" in created
    assert "Success: Memory at 'core://salem_note' updated" == updated
    assert "Added: Salem" in triggers
    assert "core://salem_note" in search
    assert "Success: Alias 'project://salem_alias'" in alias
    assert "Success: Memory 'project://salem_alias' deleted." in deleted
    assert current["content"].endswith("GraphService handles aliases.")
    assert removed_alias is None


# =============================================================================
# Unit tests for _normalize_with_positions
# =============================================================================


class TestNormalizeWithPositions:
    def test_straight_quotes_unchanged(self, mcp_module):
        text = 'She said "hello" to him.'
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == text
        assert len(pos_map) == len(norm)
        assert all(pos_map[i] == i for i in range(len(norm)))

    def test_curly_quotes_normalized(self, mcp_module):
        text = "She said \u201chello\u201d to him."
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == 'She said "hello" to him.'
        assert pos_map[0] == 0  # 'S'
        assert pos_map[9] == 9  # curly open quote maps to original pos 9

    def test_dash_variants(self, mcp_module):
        text = "range\u2014end"
        norm, _ = mcp_module._normalize_with_positions(text)
        assert norm == "range-end"

    def test_trailing_whitespace_stripped(self, mcp_module):
        text = "hello   \nworld"
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == "hello\nworld"
        assert pos_map[5] == 8  # '\n' at original position 8

    def test_consecutive_spaces_collapsed(self, mcp_module):
        text = "hello    world"
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == "hello world"
        assert pos_map[5] == 5  # first space kept
        assert pos_map[6] == 9  # 'w' at original position 9

    def test_leading_spaces_preserved(self, mcp_module):
        text = "    - item"
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == "    - item"
        assert len(pos_map) == len(norm)
        assert pos_map[0] == 0
        assert pos_map[3] == 3
        assert pos_map[4] == 4  # '-'

    def test_mixed_leading_and_inline_spaces(self, mcp_module):
        text = "    hello    world"
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == "    hello world"
        assert len(norm) == 15
        assert pos_map[9] == 9  # space after hello
        assert pos_map[10] == 13 # 'w'

    def test_empty_string(self, mcp_module):
        norm, pos_map = mcp_module._normalize_with_positions("")
        assert norm == ""
        assert pos_map == []

    def test_multiline_with_mixed_issues(self, mcp_module):
        text = "line1   \n  \u201chello\u201d   \nend"
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == 'line1\n  "hello"\nend'
        assert len(pos_map) == len(norm)

    def test_crlf_normalized_to_lf(self, mcp_module):
        text = "line1\r\nline2\r\nline3"
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == "line1\nline2\nline3"
        assert len(pos_map) == len(norm)
        assert pos_map[5] == 6  # '\n' maps to the original '\n' which is at index 6
        assert pos_map[6] == 7  # 'l' in line2

    def test_backtick_is_not_normalized(self, mcp_module):
        text = "Run `update` command."
        norm, pos_map = mcp_module._normalize_with_positions(text)
        assert norm == "Run `update` command."


# =============================================================================
# Unit tests for _try_normalized_patch
# =============================================================================


class TestTryNormalizedPatch:
    def test_curly_to_straight_quote_patch(self, mcp_module):
        content = "She said \u201chello\u201d to him."
        result = mcp_module._try_normalized_patch(
            content, 'She said "hello"', 'She said "goodbye"'
        )
        assert result is not None
        assert '"goodbye"' in result
        assert "to him." in result

    def test_dash_variant_patch(self, mcp_module):
        content = "range: 10\u201420"
        result = mcp_module._try_normalized_patch(
            content, "range: 10-20", "range: 10-30"
        )
        assert result is not None
        assert "10-30" in result

    def test_trailing_whitespace_patch(self, mcp_module):
        content = "hello   \nworld"
        result = mcp_module._try_normalized_patch(
            content, "hello\nworld", "goodbye\nworld"
        )
        assert result is not None
        assert result.startswith("goodbye\n")

    def test_space_collapse_patch(self, mcp_module):
        content = "A    B    C"
        result = mcp_module._try_normalized_patch(
            content, "A B", "X Y"
        )
        assert result is not None
        assert result.startswith("X Y")
        assert result.endswith("C")

    def test_no_match_returns_none(self, mcp_module):
        result = mcp_module._try_normalized_patch(
            "hello world", "completely different", "replacement"
        )
        assert result is None

    def test_ambiguous_match_returns_none(self, mcp_module):
        content = 'He said "yes". She said "yes".'
        result = mcp_module._try_normalized_patch(
            content, '"yes"', '"no"'
        )
        assert result is None

    def test_exact_match_still_needed_when_no_normalization_diff(self, mcp_module):
        content = "hello world"
        result = mcp_module._try_normalized_patch(
            content, "helo world", "replacement"
        )
        assert result is None


# =============================================================================
# Integration: update_memory with normalized fallback
# =============================================================================


async def test_update_memory_falls_back_to_normalized_patch(
    mcp_module, graph_service
):
    original_content = "Nocturne said \u201cI will not kneel.\u201d That is final."
    await graph_service.create_memory(
        parent_path="",
        content=original_content,
        priority=1,
        title="norm_test",
    )

    result = await mcp_module.update_memory(
        "core://norm_test",
        old_string='Nocturne said "I will not kneel."',
        new_string='Nocturne said "I refuse to kneel."',
    )
    assert result == "Success: Memory at 'core://norm_test' updated"

    memory = await graph_service.get_memory_by_path("norm_test", "core")
    assert '"I refuse to kneel."' in memory["content"]
    assert "That is final." in memory["content"]


async def test_update_memory_exact_match_takes_priority(
    mcp_module, graph_service
):
    """Exact match must be used when available, not normalized."""
    await graph_service.create_memory(
        parent_path="",
        content="Hello World",
        priority=1,
        title="exact_test",
    )
    result = await mcp_module.update_memory(
        "core://exact_test",
        old_string="Hello",
        new_string="Goodbye",
    )
    assert result == "Success: Memory at 'core://exact_test' updated"
    memory = await graph_service.get_memory_by_path("exact_test", "core")
    assert memory["content"] == "Goodbye World"


async def test_update_memory_normalized_ambiguous_returns_error(
    mcp_module, graph_service
):
    content = "He said \u201cyes\u201d. She said \u201cyes\u201d."
    await graph_service.create_memory(
        parent_path="",
        content=content,
        priority=1,
        title="ambig_test",
    )
    result = await mcp_module.update_memory(
        "core://ambig_test",
        old_string='"yes"',
        new_string='"no"',
    )
    assert "Error" in result
    assert "normalization" in result.lower()
