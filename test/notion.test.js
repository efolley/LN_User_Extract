"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const notion = require("../src/notion.js");

describe("richText", () => {
  test("wraps short text in a single rich_text item", () => {
    const result = notion.richText("Hello world");
    assert.deepEqual(result, [{ type: "text", text: { content: "Hello world" } }]);
  });

  test("splits text longer than 2000 characters into multiple items", () => {
    const long = "a".repeat(4500);
    const result = notion.richText(long);
    assert.equal(result.length, 3);
    assert.equal(result[0].text.content.length, 2000);
    assert.equal(result[2].text.content.length, 500);
  });
});

describe("findTitlePropertyName", () => {
  test("returns the key of the property whose type is 'title'", () => {
    const properties = {
      Status: { type: "select" },
      Name: { type: "title" },
      Notes: { type: "rich_text" },
    };
    assert.equal(notion.findTitlePropertyName(properties), "Name");
  });

  test("returns null when no title property exists", () => {
    assert.equal(notion.findTitlePropertyName({ Status: { type: "select" } }), null);
  });

  test("returns null for empty/missing input", () => {
    assert.equal(notion.findTitlePropertyName(null), null);
  });
});

describe("buildPageChildren", () => {
  test("includes a bookmark for the URL and headline/location paragraphs", () => {
    const blocks = notion.buildPageChildren({
      url: "https://www.linkedin.com/in/example/",
      headline: "Engineer",
      location: "Remote",
    });

    assert.equal(blocks[0].type, "bookmark");
    assert.equal(blocks[0].bookmark.url, "https://www.linkedin.com/in/example/");
    assert.ok(blocks.some((b) => b.type === "paragraph" && b.paragraph.rich_text[0].text.content === "Headline: Engineer"));
  });

  test("renders one experience entry as a bulleted header plus detail paragraphs", () => {
    const blocks = notion.buildPageChildren({
      experience: [
        {
          Title: "Engineer",
          "Company name": "Acme Corp",
          Years: "2020 - Present",
          Location: "Remote",
          Content: "Built things.",
          Skills: ["JavaScript", "Testing"],
        },
      ],
    });

    const bulletIndex = blocks.findIndex((b) => b.type === "bulleted_list_item");
    assert.ok(bulletIndex !== -1);
    assert.equal(
      blocks[bulletIndex].bulleted_list_item.rich_text[0].text.content,
      "Engineer — Acme Corp — 2020 - Present"
    );
    assert.ok(blocks.some((b) => b.paragraph?.rich_text[0].text.content === "Skills: JavaScript, Testing"));
  });

  test("includes reshared post info for a reshared activity item", () => {
    const blocks = notion.buildPageChildren({
      activity: [{ "Post type": "reshared", Content: "Nice!", "Reshared post info": "Original text" }],
    });

    assert.ok(blocks.some((b) => b.paragraph?.rich_text[0].text.content === "Reshared post: Original text"));
  });

  test("caps output at 100 blocks", () => {
    const experience = Array.from({ length: 40 }, (_, i) => ({
      Title: `Role ${i}`,
      "Company name": "Co",
      Content: "Did stuff.",
    }));
    const blocks = notion.buildPageChildren({ experience });
    assert.ok(blocks.length <= 100);
  });
});

describe("buildCreatePagePayload", () => {
  test("targets the given data source and titles the page with the profile's name", () => {
    const payload = notion.buildCreatePagePayload("ds-123", "Name", { name: "Jane Smith" });

    assert.deepEqual(payload.parent, { type: "data_source_id", data_source_id: "ds-123" });
    assert.deepEqual(payload.properties.Name.title[0].text.content, "Jane Smith");
    assert.ok(Array.isArray(payload.children));
  });

  test("falls back to a placeholder title when no name was extracted", () => {
    const payload = notion.buildCreatePagePayload("ds-123", "Name", {});
    assert.equal(payload.properties.Name.title[0].text.content, "Untitled LinkedIn profile");
  });
});

describe("extractNotionId", () => {
  test("extracts a dashed UUID from a full database URL", () => {
    const url = "https://www.notion.so/myworkspace/1a2b3c4d-5e6f-7890-abcd-ef1234567890?v=abc";
    assert.equal(notion.extractNotionId(url), "1a2b3c4d-5e6f-7890-abcd-ef1234567890");
  });

  test("extracts a bare 32-char ID from a URL with no dashes", () => {
    const url = "https://www.notion.so/myworkspace/1a2b3c4d5e6f7890abcdef1234567890?v=abc";
    assert.equal(notion.extractNotionId(url), "1a2b3c4d5e6f7890abcdef1234567890");
  });

  test("passes a raw ID through unchanged", () => {
    assert.equal(notion.extractNotionId("1a2b3c4d5e6f7890abcdef1234567890"), "1a2b3c4d5e6f7890abcdef1234567890");
  });

  test("returns an empty string for empty input", () => {
    assert.equal(notion.extractNotionId(""), "");
  });
});
