# Agent Instructions

The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the AgentMD file to help prevent future agents from having the same issue.

## Project Structure

- This is a greenfield project and its okay to make drastic changes to the codebase.
- The code base should primarily use Typescript (node v24.14.0) and Python 3.13 (uv)

## Code Standards

- All development should follow test driven design, with tests and plans being outlined before any functional changes are made to the code
- Start with function contracts prior to populating code
- Don't litter the codebase with emojis where possible
- Where needed use the following commands to verify package vulnerabilities
  - frontend: `npm audit`
  - backend: `uv export --format requirements.txt > requirements.txt | pip-audit`

## Learnings & Resolved Confusion Points
