# Advent Village

This is the Christmas advent calendar of the Cover to Cover YouTube channel. It is a snowy floating island with 24 houses, one for each day of December, and each house stands for one book. Visitors drag to look around the village and tap a house to fly to it and see its book card.

The doors follow the visitor's local date. In December 2026, the houses up to today's date are lit and their cards show the book. Later houses stay dark and the card only says when the door opens. The site is static: plain HTML, CSS and JavaScript modules, with three.js loaded from cdn.jsdelivr.net. There is no build step.

## Preview locally

From the repository root, run `python3 -m http.server`, then open `http://localhost:8000/2026/` in a browser. Add `?day=N` to the address to preview a day, for example `/2026/?day=12` opens doors 1 to 12. `?day=0` closes all doors and `?day=24` opens all of them.

## Add a reading

Each book is an entry in `2026/data/books.json`. When a reading is public on YouTube, set its `video` field to the YouTube video id (the part after `v=` in the address). The card then links to that video. While `video` is `null`, the card links to the channel.
