function extractGeneric() {
    const article =
        new Readability(
            document.cloneNode(true)
        ).parse();
    if (!article) {
        return {
            type: "generic",
            title: document.title,
            url: location.href,
            content:
                document.body.innerText
        };
    }
    return {
        type: "article",
        title: article.title,
        url: location.href,
        content:
            article.textContent
    };
}