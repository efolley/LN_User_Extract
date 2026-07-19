"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const parser = require("../src/parser.js");

describe("clean", () => {
  test("collapses whitespace and non-breaking spaces, and trims", () => {
    assert.equal(parser.clean("  Hello  world  \n"), "Hello world");
  });

  test("returns an empty string for null/undefined", () => {
    assert.equal(parser.clean(null), "");
    assert.equal(parser.clean(undefined), "");
  });
});

describe("toLines", () => {
  test("splits on newlines and drops blank lines", () => {
    const result = parser.toLines("Jane Smith\n\nMarketing Lead\n  \nSan Francisco Bay Area");
    assert.deepEqual(result, ["Jane Smith", "Marketing Lead", "San Francisco Bay Area"]);
  });
});

describe("isBoilerplateLine", () => {
  test("flags connection/follower counters", () => {
    assert.equal(parser.isBoilerplateLine("500+ connections"), true);
    assert.equal(parser.isBoilerplateLine("1,204 followers"), false); // commas aren't digits-only; documents current behavior
  });

  test("flags pronoun and degree badges", () => {
    assert.equal(parser.isBoilerplateLine("(He/Him)"), true);
    assert.equal(parser.isBoilerplateLine("2nd"), true);
  });

  test("does not flag ordinary headline text", () => {
    assert.equal(parser.isBoilerplateLine("Marketing Lead @ Acme Corp"), false);
  });
});

describe("dedupeRepeatedText", () => {
  test("collapses text that is exactly duplicated back-to-back", () => {
    const doubled = "Some About text.Some About text.";
    assert.equal(parser.dedupeRepeatedText(doubled), "Some About text.");
  });

  test("leaves non-duplicated text untouched", () => {
    assert.equal(parser.dedupeRepeatedText("A unique sentence."), "A unique sentence.");
  });
});

describe("parseSkillsLine", () => {
  test("strips the Skills label and trailing '+N skills' suffix", () => {
    const result = parser.parseSkillsLine("Skills: Growth Marketing · SQL · Leadership and +2 skills");
    assert.deepEqual(result, ["Growth Marketing", "SQL", "Leadership"]);
  });

  test("splits on commas too", () => {
    assert.deepEqual(parser.parseSkillsLine("Skills: Python, SQL, Excel"), ["Python", "SQL", "Excel"]);
  });
});

describe("looksLikeLocation", () => {
  test("accepts short city/region phrases", () => {
    assert.equal(parser.looksLikeLocation("San Francisco Bay Area"), true);
    assert.equal(parser.looksLikeLocation("San Francisco, CA"), true);
  });

  test("rejects date lines and long sentences", () => {
    assert.equal(parser.looksLikeLocation("Jan 2022 - Present · 2 yrs"), false);
    assert.equal(parser.looksLikeLocation("Led a team of 5 to grow signups by 40% YoY."), false);
  });
});

describe("parseCompanyTypeLine", () => {
  test("splits 'Company · Employment type' into a company name", () => {
    assert.deepEqual(parser.parseCompanyTypeLine("Nimbus Energy · Full-time"), { company: "Nimbus Energy" });
  });

  test("recognizes a bare employment type with no company prefix", () => {
    assert.deepEqual(parser.parseCompanyTypeLine("Full-time"), { company: "" });
  });

  test("returns null for lines that aren't a company/type line at all", () => {
    assert.equal(parser.parseCompanyTypeLine("Vienna, Virginia, United States"), null);
  });
});

describe("parseExperienceEntry", () => {
  test("parses a standalone role with company embedded in its own line", () => {
    const lines = [
      "Director of Digital",
      "Nimbus Energy · Full-time",
      "Feb 2025 - Present · 1 yr 6 mos",
      "Vienna, Virginia, United States",
      "Leads digital strategy for the retail energy business unit.",
    ];
    const entry = parser.parseExperienceEntry(lines, ["https://www.linkedin.com/company/1528519/"], "");

    assert.equal(entry["Company name"], "Nimbus Energy");
    assert.equal(entry.Title, "Director of Digital");
    assert.equal(entry.Years, "Feb 2025 - Present · 1 yr 6 mos");
    assert.equal(entry.Location, "Vienna, Virginia, United States");
    assert.equal(entry.Content, "Leads digital strategy for the retail energy business unit.");
    assert.deepEqual(entry["All available links"], ["https://www.linkedin.com/company/1528519/"]);
  });

  test("parses a grouped role where company comes from a shared header, not the entry's own text", () => {
    const lines = [
      "Head of Innovation (Director-level)",
      "Full-time",
      "Feb 2016 - Mar 2022 · 6 yrs 2 mos",
      "Established innovation processes for a $60M program.",
    ];
    const entry = parser.parseExperienceEntry(lines, [], "Union Buildworks");

    assert.equal(entry["Company name"], "Union Buildworks");
    assert.equal(entry.Title, "Head of Innovation (Director-level)");
    // The bare "Full-time" line must never leak into Content or Company name.
    assert.ok(!entry.Content.includes("Full-time"));
  });

  test("leaves company name empty rather than guessing when nothing resolves it", () => {
    const lines = ["Intern", "Internship", "Jun 2017 - Aug 2017 · 3 mos"];
    const entry = parser.parseExperienceEntry(lines, [], "");
    assert.equal(entry["Company name"], "");
  });

  test("extracts a Skills line separately from Content", () => {
    const lines = [
      "Senior Marketing Manager",
      "Beta Inc · Full-time",
      "Jun 2018 - Dec 2021 · 3 yrs 7 mos",
      "San Francisco Bay Area",
      "Led a team of 5 to grow signups by 40% YoY.",
      "Skills: Growth Marketing · SQL · Leadership and +2 skills",
    ];
    const entry = parser.parseExperienceEntry(lines, [], "");
    assert.deepEqual(entry.Skills, ["Growth Marketing", "SQL", "Leadership"]);
    assert.ok(!entry.Content.includes("Skills:"));
  });
});

describe("extractSectionLines", () => {
  test("slices out just the lines belonging to the requested section", () => {
    const lines = [
      "Jane Smith",
      "About",
      "Results-driven leader with 10 years experience.",
      "Experience",
      "Marketing Lead",
      "Education",
      "Some University",
    ];
    assert.deepEqual(parser.extractSectionLines(lines, "About"), [
      "Results-driven leader with 10 years experience.",
    ]);
  });

  test("returns an empty array when the section heading isn't present", () => {
    assert.deepEqual(parser.extractSectionLines(["Jane Smith", "Experience"], "About"), []);
  });
});

describe("stripAuthorHeader", () => {
  test("removes the leading name/degree/headline/time preamble from a post", () => {
    const raw =
      "Alex Rivera • 2nd Co-Founder & CEO at Verdant Labs 1d • Sharing a quick update on a project milestone we hit this week.";
    assert.equal(
      parser.stripAuthorHeader(raw),
      "Sharing a quick update on a project milestone we hit this week."
    );
  });

  test("leaves text unchanged if no relative-time marker is found", () => {
    assert.equal(parser.stripAuthorHeader("No time marker here"), "No time marker here");
  });
});

describe("isShowAllText", () => {
  test("flags 'Show all' / 'See all' navigation links", () => {
    assert.equal(parser.isShowAllText("Show all featured items"), true);
    assert.equal(parser.isShowAllText("See all activity"), true);
  });

  test("does not flag ordinary post content", () => {
    assert.equal(parser.isShowAllText("Excited to share this milestone with my network"), false);
  });
});

describe("parseFeaturedEntry", () => {
  test("classifies a reshare via 'Reshared by' wording", () => {
    const entry = parser.parseFeaturedEntry("Reshared by Alex Rivera This took the whole team's effort.");
    assert.equal(entry["Post type"], "reshared");
  });

  test("classifies ordinary content as a post", () => {
    const entry = parser.parseFeaturedEntry("Excited to announce our new product launch.");
    assert.equal(entry["Post type"], "post");
  });
});

describe("parseActivityEntry", () => {
  test("strips the author header for a plain post", () => {
    const raw =
      "Alex Rivera • 2nd Co-Founder & CEO at Verdant Labs 1d • Sharing a quick update on a project milestone we hit this week.";
    const entry = parser.parseActivityEntry(raw, "");
    assert.equal(entry["Post type"], "post");
    assert.equal(entry.Content, "Sharing a quick update on a project milestone we hit this week.");
    assert.equal(entry["Reshared post info"], undefined);
  });

  test("splits a reshare into the person's own comment and the embedded original post", () => {
    const raw =
      "Jane Doe • 1st reposted this 3d • Congrats on this milestone! Original Author • 2nd Founder at Acme 1w • We just shipped a huge feature.";
    const nestedText = "Original Author • 2nd Founder at Acme 1w • We just shipped a huge feature.";
    const entry = parser.parseActivityEntry(raw, nestedText);

    assert.equal(entry["Post type"], "reshared");
    assert.equal(entry.Content, "Congrats on this milestone!");
    assert.equal(entry["Reshared post info"], nestedText);
  });
});
