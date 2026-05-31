function extractYoutube() {
    const title =
        document.querySelector(
            "h1.ytd-watch-metadata"
        )?.innerText ||
        document.title;
    const description =
        document.querySelector(
            "#description-inline-expander"
        )?.innerText ||
        "";
    const content = `Video Title:\n${title}\n\nDescription:\n${description}`;
    console.log("YT TITLE:", title);
    console.log(
        "YT DESCRIPTION LENGTH:",
        description.length
    );

    return {
        type: "youtube",
        title,
        url: location.href,
        content
    };
}