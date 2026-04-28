export const id = 230;
export const ids = [230];
export const modules = {

/***/ 1230:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   listPullRequestFiles: () => (/* binding */ listPullRequestFiles)
/* harmony export */ });
async function listPullRequestFiles(octokit, params) {
    return octokit.paginate(octokit.pulls.listFiles, {
        ...params,
        per_page: 100,
    });
}


/***/ })

};

//# sourceMappingURL=230.index.js.map