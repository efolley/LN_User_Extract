/**
 * Pure text-parsing logic for the LinkedIn Profile Extractor.
 *
 * Nothing in this file touches `document`, `window`, or `chrome` APIs.
 * That's deliberate: it's what lets these functions run unmodified under
 * plain Node.js in the test suite (see test/parser.test.js), while also
 * being loaded as a plain script inside the extension's content-script
 * context (see src/content.js), which does the DOM traversal and hands
 * plain strings/arrays in here for parsing.
 */
(function (global) {
  "use strict";

  const SECTION_NAMES = [
    "About",
    "Experience",
    "Featured",
    "Activity",
    "Education",
    "Licenses & certifications",
    "Skills",
    "Recommendations",
    "Languages",
    "Interests",
  ];

  const DATE_LINE_RE =
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b\d{4}\s*-\s*(present|\d{4})\b|\bpresent\b|\d+\s*(yr|yrs|year|years|mo|mos|month|months)\b/i;

  const EMPLOYMENT_TYPE_RE =
    /^(full-time|part-time|self-employed|freelance|contract|internship|apprenticeship|seasonal)\b/i;

  const SHOW_ALL_RE = /^(show|see) all\b/i;

  const RESHARE_RE = /\brepost(?:ed|s)?\b|\breshared?\b|\bshared\s+this\b/i;

  const RELATIVE_TIME_RE =
    /\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|yr|yrs|year|years)\s*•/i;

  function clean(value) {
    return String(value || "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toLines(rawText) {
    return String(rawText || "")
      .replace(/ /g, " ")
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);
  }

  function isBoilerplateLine(line) {
    if (!line) return true;
    if (/^\d+(\+)?\s+(connections?|followers?|mutual connections?)$/i.test(line)) return true;
    if (/^(contact info|add section|visit my website|edit intro|message|follow|connect|pending|more|save|share)$/i.test(line)) return true;
    if (/^open to\b/i.test(line)) return true;
    if (/^\(?(he\/him|she\/her|they\/them)\)?$/i.test(line)) return true;
    if (/^[·•]?\s*(1st|2nd|3rd)\+?$/i.test(line)) return true;
    return false;
  }

  function dedupeRepeatedText(text) {
    const value = clean(text);
    const length = value.length;
    if (length > 0 && length % 2 === 0) {
      const half = length / 2;
      if (value.slice(0, half) === value.slice(half)) {
        return value.slice(0, half).trim();
      }
    }
    return value;
  }

  function isDateLine(line) {
    return DATE_LINE_RE.test(line);
  }

  function isEmploymentTypeLine(line) {
    return EMPLOYMENT_TYPE_RE.test(line);
  }

  function isShowAllText(text) {
    return SHOW_ALL_RE.test(text);
  }

  function isReshareText(text) {
    return RESHARE_RE.test(text);
  }

  function looksLikeLocation(line) {
    if (!line) return false;
    if (/^skills\b[:\s]/i.test(line)) return false;
    if (isDateLine(line)) return false;
    const wordCount = line.split(/\s+/).length;
    if (wordCount > 6) return false;
    if (/[.!?]$/.test(line)) return false;
    return true;
  }

  function stripAfterDot(line) {
    return clean(line.split("·")[0]);
  }

  function parseSkillsLine(line) {
    const stripped = line
      .replace(/^skills\b[:\s]*/i, "")
      .replace(/\s+and\s+\+?\d+\s+(more|others?|skills?)\.?$/i, "");
    return stripped
      .split(/[·,]/)
      .map((skill) => clean(skill))
      .filter(Boolean);
  }

  function parseCompanyTypeLine(line) {
    if (!line) return null;
    if (isEmploymentTypeLine(line)) return { company: "" };

    const parts = line.split("·").map((part) => clean(part));
    if (parts.length >= 2 && isEmploymentTypeLine(parts[parts.length - 1])) {
      return { company: parts[0] };
    }
    return null;
  }

  /**
   * Parses one experience entry's already-split lines of text into a
   * structured record. `company` is the name resolved by the DOM layer
   * (e.g. from a shared company-group header); if empty, this function
   * falls back to deriving it from a "Company · Employment type" line
   * when present (the shape used by standalone, non-grouped roles).
   */
  function parseExperienceEntry(lines, links, company) {
    const remaining = lines.filter((line) => !isBoilerplateLine(line));

    const skillsLineIndex = remaining.findIndex((line) => /^skills\b[:\s]/i.test(line));
    const skills = skillsLineIndex === -1 ? [] : parseSkillsLine(remaining[skillsLineIndex]);

    const yearsIndex = remaining.findIndex((line) => isDateLine(line));
    const years = yearsIndex === -1 ? "" : remaining[yearsIndex];

    const title = remaining[0] || "";
    let cursor = 1;
    let derivedCompany = "";

    const companyTypeMatch = parseCompanyTypeLine(remaining[cursor]);
    if (companyTypeMatch) {
      derivedCompany = companyTypeMatch.company;
      cursor += 1;
    }

    const resolvedCompany = company || derivedCompany;

    if (yearsIndex !== -1 && yearsIndex >= cursor) {
      cursor = yearsIndex + 1;
    }

    let location = "";
    const locationCandidate = remaining[cursor];
    if (
      locationCandidate &&
      locationCandidate !== years &&
      skillsLineIndex !== cursor &&
      looksLikeLocation(locationCandidate)
    ) {
      location = locationCandidate;
      cursor += 1;
    }

    const content = remaining
      .filter((line, index) => {
        if (index < cursor) return false;
        if (index === skillsLineIndex) return false;
        if (line === title || line === years || line === location) return false;
        return true;
      })
      .join(" ");

    return {
      "Company name": clean(resolvedCompany || ""),
      Title: clean(title),
      Years: clean(years),
      Location: clean(location),
      Content: clean(content),
      "All available links": links,
      Skills: skills,
    };
  }

  /**
   * Slices the lines of a full section (e.g. the whole page's text) down
   * to the lines that sit between `startLabel`'s heading and the next
   * known profile section heading. Used for simple single-block sections
   * like About.
   */
  function extractSectionLines(lines, startLabel) {
    const startIndex = lines.findIndex((line) => line.toLowerCase() === startLabel.toLowerCase());
    if (startIndex === -1) return [];

    const stopIndex = lines.findIndex(
      (line, index) =>
        index > startIndex && SECTION_NAMES.some((section) => line.toLowerCase() === section.toLowerCase())
    );

    const endIndex = stopIndex === -1 ? lines.length : stopIndex;
    return lines.slice(startIndex + 1, endIndex).filter((line, index, arr) => line !== arr[index - 1]);
  }

  function stripAuthorHeader(text) {
    const match = text.match(RELATIVE_TIME_RE);
    if (!match) return text;
    return clean(text.slice(match.index + match[0].length));
  }

  function parseFeaturedEntry(text) {
    return {
      "Post type": isReshareText(text) ? "reshared" : "post",
      Content: clean(text),
    };
  }

  /**
   * `rawText` is the full innerText of one activity list item. `nestedText`,
   * if provided, is the innerText of a nested sub-container the DOM layer
   * identified as the embedded original post (present only for reshares).
   */
  function parseActivityEntry(rawText, nestedText) {
    const isReshared = isReshareText(rawText);
    const bodyText = stripAuthorHeader(rawText);

    if (!isReshared) {
      return { "Post type": "post", Content: bodyText };
    }

    let ownComment = bodyText;
    let resharedPost = "";

    if (nestedText) {
      resharedPost = clean(nestedText);
      const splitIndex = bodyText.indexOf(resharedPost);
      if (splitIndex > -1) {
        ownComment = clean(bodyText.slice(0, splitIndex));
      }
    }

    return {
      "Post type": "reshared",
      Content: ownComment,
      "Reshared post info": resharedPost,
    };
  }

  const api = {
    SECTION_NAMES,
    clean,
    toLines,
    isBoilerplateLine,
    dedupeRepeatedText,
    isDateLine,
    isEmploymentTypeLine,
    isShowAllText,
    isReshareText,
    looksLikeLocation,
    stripAfterDot,
    parseSkillsLine,
    parseCompanyTypeLine,
    parseExperienceEntry,
    extractSectionLines,
    stripAuthorHeader,
    parseFeaturedEntry,
    parseActivityEntry,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ProfileExtractorParser = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
