(function() {
    "use strict";

    if (!window.HyperMD?.Fold) {
        return;
    }
    let fold = window.HyperMD.Fold;
    let activeImagePreview = null;

    const IMAGE_PREVIEW_MOTION_DURATION = 320;
    const IMAGE_PREVIEW_MOTION_EASING = "cubic-bezier(0.22, 0.78, 0.24, 1)";

    function prefersReducedMotion() {
        return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    }

    function sourceToPreviewTransform(sourceRect, previewRect) {
        if (!sourceRect.width || !sourceRect.height || !previewRect.width || !previewRect.height) {
            return "scale(0.86)";
        }

        const sourceX = sourceRect.left + sourceRect.width / 2;
        const sourceY = sourceRect.top + sourceRect.height / 2;
        const previewX = previewRect.left + previewRect.width / 2;
        const previewY = previewRect.top + previewRect.height / 2;
        const scale = Math.max(0.04, Math.min(
            1,
            sourceRect.width / previewRect.width,
            sourceRect.height / previewRect.height,
        ));

        return `translate(${sourceX - previewX}px, ${sourceY - previewY}px) scale(${scale})`;
    }

    /**
     * A shared-element preview: the full-size image starts at the inline image's
     * exact screen position, and closing reverses the same animation objects.
     */
    function openImagePreview(source, cm) {
        activeImagePreview?.close(true);

        const sourceRect = source.getBoundingClientRect();
        const sourceRadius = window.getComputedStyle(source).borderRadius || "0px";
        const modal = document.createElement("div");
        modal.className = "hmd-image-preview-modal";
        modal.tabIndex = -1;
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-label", "Image preview. Click or press Escape to close.");

        const imgPreview = document.createElement("img");
        imgPreview.src = source.src;
        imgPreview.alt = source.alt || source.title || "";
        imgPreview.className = "hmd-image-preview";
        imgPreview.style.visibility = "hidden";
        imgPreview.draggable = false;
        modal.appendChild(imgPreview);

        let animations = [];
        let closing = false;
        let cleaned = false;

        const cleanup = () => {
            if (cleaned) {
                return;
            }
            cleaned = true;
            document.removeEventListener("keydown", handleKeyDown, true);
            animations.forEach((animation) => animation.cancel());
            modal.remove();
            if (activeImagePreview?.modal === modal) {
                activeImagePreview = null;
            }
            cm?.focus();
        };

        const closeModal = (immediate = false) => {
            if (closing) {
                return;
            }
            closing = true;
            document.removeEventListener("keydown", handleKeyDown, true);

            if (immediate || prefersReducedMotion() || animations.length === 0) {
                cleanup();
                return;
            }

            const closingAnimations = animations.map((animation) => {
                animation.updatePlaybackRate(-Math.abs(animation.playbackRate || 1));
                animation.play();
                return animation.finished.catch(() => undefined);
            });
            Promise.all(closingAnimations).then(cleanup);
        };

        const handleKeyDown = (event) => {
            if (event.key !== "Escape") {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
            closeModal();
        };

        const startMotion = () => {
            if (closing || cleaned || !modal.isConnected) {
                return;
            }

            imgPreview.style.visibility = "visible";
            if (prefersReducedMotion() || typeof modal.animate !== "function") {
                return;
            }

            const previewRect = imgPreview.getBoundingClientRect();
            const startTransform = sourceToPreviewTransform(sourceRect, previewRect);
            const previewRadius = window.getComputedStyle(imgPreview).borderRadius || "12px";
            const options = {
                duration: IMAGE_PREVIEW_MOTION_DURATION,
                easing: IMAGE_PREVIEW_MOTION_EASING,
                fill: "both",
            };

            animations = [
                modal.animate([
                    { opacity: 0 },
                    { opacity: 1 },
                ], options),
                imgPreview.animate([
                    { opacity: 0.36, transform: startTransform, borderRadius: sourceRadius },
                    { opacity: 1, transform: "translate(0, 0) scale(1)", borderRadius: previewRadius },
                ], options),
            ];
        };

        modal.addEventListener("click", () => closeModal());
        document.addEventListener("keydown", handleKeyDown, true);
        document.body.appendChild(modal);
        activeImagePreview = { modal, close: closeModal };
        modal.focus({preventScroll: true});

        if (imgPreview.complete) {
            requestAnimationFrame(startMotion);
        } else {
            imgPreview.addEventListener("load", () => requestAnimationFrame(startMotion), {once: true});
            imgPreview.addEventListener("error", () => requestAnimationFrame(startMotion), {once: true});
        }
    }

    function ImageFolder(stream, token) {
        let cm = stream.cm;
        let imgRE = /\bimage-marker\b/;
        let urlRE = /\bformatting-link-string\b/; // matches the parentheses
        if (imgRE.test(token.type) && token.string === "!") {
            let lineNo = stream.lineNo;
            // find the begin and end of url part
            let url_begin = stream.findNext(urlRE);
            let url_end = stream.findNext(urlRE, url_begin.i_token + 1);
            let from = {line: lineNo, ch: token.start};
            let to = {line: lineNo, ch: url_end.token.end};

            let rngReq = stream.requestRange(from, to, from, from);
            if (rngReq === fold.RequestRangeResult.OK) {
                // That fixes blinking on select, for some reason range CI is returned even though cursor is outside of our tokens
                if (cm.somethingSelected()) {
                    return null;
                }

                let url;
                let title;
                let rawurl;
                { // extract the URL
                    rawurl = cm.getRange(// get the URL or footnote name in the parentheses
                        {line: lineNo, ch: url_begin.token.start + 1}, {line: lineNo, ch: url_end.token.start});
                    if (url_end.token.string === "]") {
                        let tmp = cm.hmdReadLink(rawurl, lineNo);
                        if (!tmp)
                            return null; // Yup! bad URL?!
                        rawurl = tmp.content;
                    }
                    url = cm.hmdResolveURL(rawurl);
                }
                { // extract the title
                    title = cm.getRange({line: lineNo, ch: from.ch + 2}, {line: lineNo, ch: url_begin.token.start - 1});
                }
                // PATCHED, treat ![](foo.mp4) as an inline autoplaying video
                // and ![](foo.mp3) as an inline audio player. Detect on rawurl
                // - hmdResolveURL may have rewritten the local-file path to a
                // blob: URL with no extension. Browsers require `muted` for
                // video autoplay.
                const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(rawurl);
                const isAudio = /\.(mp3|ogg|oga|wav)(\?|$)/i.test(rawurl);
                let media;
                if (isVideo) {
                    media = document.createElement("video");
                    media.autoplay = true;
                    media.muted = true;
                    media.loop = true;
                    media.playsInline = true;
                    media.controls = true;
                } else if (isAudio) {
                    media = document.createElement("audio");
                    media.controls = true;
                    media.preload = "metadata";
                } else {
                    media = document.createElement("img");
                    media.style.cursor = "pointer";
                }
                if (isVideo || isAudio) {
                    // We should release focus, so that app can catch hotkeys.
                    media.addEventListener('focus', () => {
                        requestAnimationFrame(() => {
                            setTimeout(() => {
                                if (document.activeElement === media) {
                                    media.blur();
                                }
                            }, 0);
                        });
                    });
                }
                // PATCHED, we don't want blank line with the cursor after image
                let wrapper = document.createElement("span");
                wrapper.style.display = "inline-flex";
                wrapper.style.justifyContent = "center";
                wrapper.style.alignItems = "center";
                wrapper.style.width = "100%";
                wrapper.style.textAlign = "center";
                wrapper.appendChild(media);
                wrapper.addEventListener('click', function () {
                    cm.focus();
                    const lineNo = from.line;
                    const lineLength = cm.getLine(lineNo).length;
                    cm.setCursor({line: lineNo, ch: lineLength});
                });

                let marker = cm.markText(from, to, {
                    clearOnEnter: false,
                    collapsed: true,
                    // PATCHED, was img
                    replacedWith: media,
                });
                if (!isVideo && !isAudio) {
                    media.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openImagePreview(media, cm);
                    }, false);
                }
                const readyEvent = (isVideo || isAudio) ? 'loadedmetadata' : 'load';
                media.addEventListener(readyEvent, function () {
                    media.classList.remove("hmd-image-loading");
                    marker.changed();
                }, false);
                media.addEventListener('error', function () {
                    media.classList.remove("hmd-image-loading");
                    media.classList.add("hmd-image-error");
                    marker.changed();
                }, false);
                media.className = "hmd-image hmd-image-loading";
                media.src = url;
                media.title = title;
                return marker;
            }
            // else {
            //     // if (DEBUG) {
            //     //     console.log("[image]FAILED TO REQUEST RANGE: ", rngReq);
            //     // }
            // }
            // PATCHED, add ![[img/link]] support, TODO it is copypaste from above
        } else if (token.string === "!") {
            // <span >!<span
            // className="cm-formatting cm-formatting-link cm-link cm-hmd-barelink">[[</span><span
            // className="cm-string cm-url cm-hmd-barelink">media/2025-07-06T10-42-31-614Z.png</span><span
            // className="cm-formatting cm-formatting-link cm-link cm-hmd-barelink">]]</span></span>
            // PATCHED, require `[[` to sit IMMEDIATELY after `!` - otherwise
            // `! [[wikilink]]` (with a space) and similar non-image lines get
            // mistakenly folded into a broken <img>.
            const lineText = cm.getLine(stream.lineNo);
            if (lineText.substring(token.end, token.end + 2) !== "[[") {
                return null;
            }
            let urlRE = /\burl\b/;

            let lineNo = stream.lineNo;
            // find the begin and end of url part
            let url_begin = stream.findNext(urlRE);
            if (url_begin === null) {
                return;
            }
            let url_end = stream.findNext((token) => {return token.string === ']]'});
            // PATCHED, for some reason https://maps.app.goo.gl/HfuMcLjYvTyZTvmM8 in the middle of the text produced
            // an error due to url_end = null.
            if (url_end === null) {
                return;
            }

            let from = {line: lineNo, ch: token.start};
            let to = {line: lineNo, ch: url_end.token.end};


            let rngReq = stream.requestRange(from, to, from, from);
            if (rngReq === fold.RequestRangeResult.OK) {
                // That fixes blinking on select, for some reason range CI is returned even though cursor is outside of our tokens
                if (cm.somethingSelected()) {
                    return null;
                }
                let rawurl = cm.getRange(
                    {line: lineNo, ch: url_begin.token.start},
                    {line: lineNo, ch: url_end.token.start}
                );
                let url = cm.hmdResolveURL(rawurl);

                let img = document.createElement("img");
                img.style.cursor = "pointer";
                // PATCHED, we don't want blank line with the cursor after image
                let wrapper = document.createElement("span");
                wrapper.style.display = "inline-flex";
                wrapper.style.justifyContent = "center";
                wrapper.style.alignItems = "center";
                wrapper.style.width = "100%";
                wrapper.style.textAlign = "center";
                wrapper.appendChild(img);
                wrapper.addEventListener('click', function () {
                    cm.focus();
                    const lineNo = from.line;
                    const lineLength = cm.getLine(lineNo).length;
                    cm.setCursor({line: lineNo, ch: lineLength});
                });

                let marker = cm.markText(from, to, {
                    clearOnEnter: false,
                    collapsed: true,
                    replacedWith: img,
                });
                img.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openImagePreview(img, cm);
                }, false);
                img.addEventListener('load', function () {
                    img.classList.remove("hmd-image-loading");
                    marker.changed();
                }, false);
                img.addEventListener('error', function () {
                    img.classList.remove("hmd-image-loading");
                    img.classList.add("hmd-image-error");
                    marker.changed();
                }, false);
                // img.addEventListener('click', function () { return fold_1.breakMark(cm, marker); }, false);
                img.className = "hmd-image hmd-image-loading";
                img.src = url;
                return marker;
            }
        }
        return null;
    }

    // Register with HyperMD
    fold.registerFolder("image", ImageFolder, true);
})();
