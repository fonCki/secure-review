export const id = 448;
export const ids = [448];
export const modules = {

/***/ 448:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   commentableLinesByFile: () => (/* binding */ commentableLinesByFile)
/* harmony export */ });
/* unused harmony export commentableLinesFromPatch */
/**
 * Parse a unified-diff patch (as returned by GitHub's `/pulls/{n}/files` endpoint)
 * and return the set of line numbers on the **new-file side** that are valid
 * anchor points for a PR review comment.
 *
 * Valid anchor points are:
 *   - Added lines (starting with `+`)
 *   - Context lines (starting with a space)
 *
 * Deleted lines (starting with `-`) have no new-file line number and are excluded.
 * The `+++` and `---` file header rows are skipped.
 */
function commentableLinesFromPatch(patch) {
    const lines = new Set();
    if (!patch)
        return lines;
    let newLineNo = 0;
    let inHunk = false;
    for (const raw of patch.split('\n')) {
        // Hunk header: @@ -oldStart,oldLen +newStart,newLen @@ optional
        const m = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m && m[1]) {
            newLineNo = parseInt(m[1], 10);
            inHunk = true;
            continue;
        }
        if (!inHunk)
            continue;
        if (raw.startsWith('+++') || raw.startsWith('---'))
            continue;
        if (raw.startsWith('+')) {
            lines.add(newLineNo);
            newLineNo++;
        }
        else if (raw.startsWith('-')) {
            // deletion — no advance on new side
        }
        else if (raw.startsWith(' ') || raw === '') {
            // context line (including blank context rows rendered without the leading space)
            lines.add(newLineNo);
            newLineNo++;
        }
        else if (raw.startsWith('\\')) {
            // '\ No newline at end of file' — not a real line
        }
        else {
            // Unknown prefix — treat as context to be safe
            lines.add(newLineNo);
            newLineNo++;
        }
    }
    return lines;
}
/**
 * Build a map from filename to the set of commentable new-file line numbers,
 * given the file objects returned by `octokit.pulls.listFiles`.
 */
function commentableLinesByFile(files) {
    const map = new Map();
    for (const f of files) {
        map.set(f.filename, commentableLinesFromPatch(f.patch));
    }
    return map;
}


/***/ })

};

//# sourceMappingURL=448.index.js.map