// Video-background hero — sits above the vendor banner to give the storefront a
// "website" feel over the DoorDash-style ordering body. Looping, muted, inline
// autoplay video with a dark scrim for text legibility and 25px rounded corners.
//
// Drop your video at  public/hero.mp4  (and optionally a still at
// public/hero-poster.jpg). If the file isn't there yet, the branded gradient +
// poster show instead, so it still looks intentional. Decorative → aria-hidden;
// respects prefers-reduced-motion (video hidden, poster/gradient shown).

import React, { useEffect, useRef, useState } from "react";
import { logo } from "../logo.js";

export default function Hero({ onOrder, onMenu, videoSrc = "/hero.mp4", poster = "/hero-poster.jpg" }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;

    const tryPlay = () => {
      video.muted = true;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch(() => {
            // Autoplay policy or low power mode fallback
            setIsPlaying(false);
          });
      }
    };

    tryPlay();
    video.addEventListener("loadeddata", tryPlay);
    video.addEventListener("canplay", tryPlay);

    // Also trigger on first interaction anywhere on page in case mobile browser paused it
    const handleFirstInteraction = () => {
      if (video.paused) {
        tryPlay();
      }
      window.removeEventListener("touchstart", handleFirstInteraction);
      window.removeEventListener("click", handleFirstInteraction);
    };

    window.addEventListener("touchstart", handleFirstInteraction, { passive: true });
    window.addEventListener("click", handleFirstInteraction, { passive: true });

    return () => {
      video.removeEventListener("loadeddata", tryPlay);
      video.removeEventListener("canplay", tryPlay);
      window.removeEventListener("touchstart", handleFirstInteraction);
      window.removeEventListener("click", handleFirstInteraction);
    };
  }, [videoSrc]);

  return (
    <section className="hero-vid" aria-label="EMET Vegan Cafe">
      <div className="hero-vid-inner">
        <video
          ref={videoRef}
          className="hero-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={poster}
          aria-hidden="true"
        >
          <source src={videoSrc} type="video/mp4" />
          <source src="https://videos.pexels.com/video-files/3195368/3195368-hd_1920_1080_25fps.mp4" type="video/mp4" />
        </video>
        <div className="hero-scrim" aria-hidden="true" />

        <div className="hero-content">
          <div className="hero-brand">
            <img src={logo} alt="" aria-hidden="true" />
            <span className="hero-word"><b>EMET</b><small>Vegan Cafe</small></span>
          </div>
          <h2 className="hero-title">
            Good Food.<br /><span className="g">Good Energy.</span><br />Rooted in Truth.
          </h2>
          <p className="hero-sub">
            Plant-based food made with purpose — blended, pressed, and prepared fresh to order.
          </p>
          <div className="hero-cta">
            <button className="hero-btn ghost" onClick={onMenu}>See the menu</button>
            <button className="hero-btn gold" onClick={onOrder}>Order ahead</button>
          </div>
        </div>
      </div>
    </section>
  );
}
