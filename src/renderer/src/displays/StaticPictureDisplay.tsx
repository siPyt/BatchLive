/** A display that shows exactly one reference picture, scaled to fit the working area. */
export function StaticPictureDisplay({ src, label }: { src: string; label: string }): JSX.Element {
  return <div className="display static-picture">
    <img src={src} alt={label} draggable={false} />
  </div>
}

export const FEED_REACTOR_PICTURE = './feed-reactor-picture.png'
