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
export declare function commentableLinesFromPatch(patch: string | undefined): Set<number>;
/**
 * Build a map from filename to the set of commentable new-file line numbers,
 * given the file objects returned by `octokit.pulls.listFiles`.
 */
export declare function commentableLinesByFile(files: readonly {
    filename: string;
    patch?: string | undefined;
}[]): Map<string, Set<number>>;
//# sourceMappingURL=diff.d.ts.map