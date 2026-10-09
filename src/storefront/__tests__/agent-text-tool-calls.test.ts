import { createTextToolCallFilter, parseTextToolCalls } from "@/lib/agent/text-tool-calls";

const XML_CALL = [
  "<tool_call>\n<function=list_catalog>\n",
  "<parameter=date_from>\n2026-10-17\n</parameter>\n",
  "<parameter=limit>\n6\n</parameter>\n",
  "<parameter=title>\nFamily events Oct 17-18\n</parameter>\n",
  "</function>\n</tool_call>",
].join("");

describe("parseTextToolCalls", () => {
  it("parses the XML function/parameter format with typed values", () => {
    expect(parseTextToolCalls(XML_CALL)).toEqual([
      {
        name: "list_catalog",
        arguments: JSON.stringify({
          date_from: "2026-10-17",
          limit: 6,
          title: "Family events Oct 17-18",
        }),
      },
    ]);
  });

  it("parses the JSON format and ignores garbage", () => {
    expect(
      parseTextToolCalls('<tool_call>{"name":"get_cart","arguments":{}}</tool_call><tool_call>?')
    ).toEqual([{ name: "get_cart", arguments: "{}" }]);
  });
});

describe("createTextToolCallFilter", () => {
  it("hides markup split across chunks and recovers the call", () => {
    const filter = createTextToolCallFilter();
    const full = `Let me check. ${XML_CALL}`;
    const visible = [full.slice(0, 19), full.slice(19, 40), full.slice(40)]
      .map((chunk) => filter.push(chunk))
      .join("");
    const rest = filter.finish();

    expect(visible + rest.text).toBe("Let me check. ");
    expect(rest.calls).toEqual([expect.objectContaining({ name: "list_catalog" })]);
  });

  it("passes ordinary text through, including a lone '<'", () => {
    const filter = createTextToolCallFilter();
    const visible = ["Prices from AED 20 ", "<", " 100."].map((c) => filter.push(c)).join("");
    expect(visible + filter.finish().text).toBe("Prices from AED 20 < 100.");
  });
});
