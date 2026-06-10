const VolcanoIcon = ({ size = 14 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, transform: "translateY(-2px)" }}
  >
    <path
      fill="#ff3c00"
      d="M12,2L2,22h20L12,2z M12,17c-0.6,0-1-0.4-1-1s0.4-1,1-1s1,0.4,1,1S12.6,17,12,17z"
    />
  </svg>
);

export default VolcanoIcon;
