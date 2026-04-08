# Project Data

This folder holds examples and notes about the GrapesJS project data we persist.

The important rule is:

the saved project data must contain the actual thing the user edited.

That means if a user changes:

- headline text
- theme
- spacing
- alignment
- part-exposed style values

then the project data should preserve those values directly or through GrapesJS component state.

## What to verify

- component tag/type is present
- attribute values are present
- style values are present
- child structure is present
- no critical state exists only in transient runtime memory
