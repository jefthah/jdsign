import type { Template } from "./templates";

/** Code-native previews mirror the browser sketches in the supplied design. */
export function TemplatePreview({ template }: { template: Template }) {
  return (
    <div
      className={`template-preview tone-${template.tone}`}
      aria-hidden="true"
    >
      <div className="preview-browser">
        <div className="browser-chrome">
          <span />
          <span />
          <span />
          <div>{template.name.toLowerCase()}.studio</div>
        </div>
        <div className="preview-page">
          <div className="preview-nav">
            <strong>
              {template.name.toLowerCase()}
              <i>®</i>
            </strong>
            <span>
              About&nbsp;&nbsp; Work&nbsp;&nbsp; Contact <b>↗</b>
            </span>
          </div>
          <div className="preview-kicker">
            INDEPENDENT BY NATURE — EST. 2026
          </div>
          <div className="preview-headline">{template.headline}</div>
          <div className="preview-description">{template.subtitle}</div>
          <div className="preview-action">
            Explore the possibilities <span>↗</span>
          </div>
          <div className="preview-art">
            <div className="art-first">
              <span />
            </div>
            <div className="art-second">
              <span />
            </div>
            <div className="art-third">
              <span />
            </div>
          </div>
          <div className="preview-caption">
            <span>A FEW THINGS WE LOVE</span>
            <span>SCROLL TO EXPLORE ↓</span>
          </div>
        </div>
      </div>
    </div>
  );
}
