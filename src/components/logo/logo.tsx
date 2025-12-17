import React, { useId } from "react";

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const Logo = () => {
  return (
    <svg
      className="rounded-[10px]"
      viewBox="0 0 400 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="400" height="400" fill="#18181B"></rect>
      <path
        d="M238.088 51.1218L238.089 51.1223L310.605 92.8101C334.028 106.308 348.526 131.32 347.868 157.953L347.867 157.966V157.978V241.688C347.867 268.68 333.687 293.362 310.271 306.856L310.269 306.858L237.754 348.878C214.336 362.374 185.643 362.374 162.225 348.878L89.7127 306.859C66.6206 293.361 52.1113 268.674 52.1113 241.688V157.978C52.1113 131.326 66.6211 106.307 89.7088 92.8093C89.7101 92.8085 89.7114 92.8078 89.7127 92.807L162.556 51.1233L162.559 51.1218C185.977 37.6261 214.67 37.6261 238.088 51.1218ZM124.634 200C124.634 241.576 158.502 275.372 200.156 275.372C242.142 275.372 276.013 241.578 276.013 200C276.013 158.419 241.805 124.628 200.156 124.628C158.502 124.628 124.634 158.424 124.634 200Z"
        fill="url(#paint0_linear_11869_12671)"
        stroke="url(#paint1_linear_11869_12671)"
        strokeWidth="2"
      ></path>
      <defs>
        <linearGradient
          id="paint0_linear_11869_12671"
          x1="200"
          y1="40"
          x2="200"
          y2="360"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white"></stop>
          <stop offset="1" stopColor="white" stopOpacity="0.7"></stop>
        </linearGradient>
        <linearGradient
          id="paint1_linear_11869_12671"
          x1="200"
          y1="40"
          x2="200"
          y2="360"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" stopOpacity="0"></stop>
          <stop offset="1" stopColor="white" stopOpacity="0.7"></stop>
        </linearGradient>
      </defs>
    </svg>
  );
};

export const LogoF: React.FC<LogoProps> = ({ size = 73, style, ...props }) => {
  const uniqueId = useId();
  const maskId = `${uniqueId}-mask`;
  const filterId = `${uniqueId}-filter`;

  return (
    <svg
      viewBox="0 0 73 73"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={props.width || size}
      height={props.height || size}
      style={{ minWidth: size, ...style }}
      {...props}
    >
      <mask id={maskId} fill="white">
        <path d="M0 16C0 7.16344 7.16344 0 16 0H57C65.8366 0 73 7.16344 73 16V57C73 65.8366 65.8366 73 57 73H16C7.16344 73 0 65.8366 0 57V16Z" />
      </mask>

      <g filter={`url(#${filterId})`}>
        <path
          d="M0 16C0 7.16344 7.16344 0 16 0H57C65.8366 0 73 7.16344 73 16V57C73 65.8366 65.8366 73 57 73H16C7.16344 73 0 65.8366 0 57V16Z"
          fill="#151515"
        />
      </g>

      <path
        d="M0 16C0 7.10822 7.20822 -0.1 16.1 -0.1H56.9C65.7918 -0.1 73 7.10822 73 16C73 7.21867 65.8366 0.1 57 0.1H16C7.16344 0.1 0 7.21867 0 16ZM73 73H0H73ZM0 73V0V73ZM73 0V73V0Z"
        fill="#C2C2C2"
        mask={`url(#${maskId})`}
      />

      <path
        d="M30.3945 25.8847L26.6973 48.873H17.1172L20.7324 25.8847H30.3945Z"
        fill="#9C9C9C"
        stroke="#B8B8B8"
        strokeWidth="0.2"
      />
      <path
        d="M42.4321 25.8847L46.1763 48.873H55.8765L52.2163 25.8847H42.4321Z"
        fill="#BEBEBE"
        stroke="#B8B8B8"
        strokeWidth="0.2"
      />
      <path
        d="M52.2443 25.9202L42.1727 43.7946L31.1429 43.7942L43.2455 22.6914L52.2443 25.9202Z"
        fill="#9C9C9C"
        stroke="#B8B8B8"
        strokeWidth="0.2"
      />
      <path
        d="M20.7737 25.8391L30.8042 43.8047L42.0583 43.8051L29.9187 22.6045L20.7737 25.8391Z"
        fill="#BEBEBE"
        stroke="#B8B8B8"
        strokeWidth="0.2"
      />
      <path
        d="M28.2806 39.7304L26.7777 48.5839L20.9291 26.5302L28.2806 39.7304Z"
        fill="#787878"
        stroke="#B8B8B8"
        strokeWidth="0.2"
      />

      <defs>
        <filter
          id={filterId}
          x="0"
          y="-1.5"
          width="73.1"
          height="74.5"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feMorphology
            radius="1.5"
            operator="erode"
            in="SourceAlpha"
            result="effect1_innerShadow_0_1"
          />
          <feOffset />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.180889 0 0 0 0 0.180889 0 0 0 0 0.180889 0 0 0 1 0"
          />
          <feBlend mode="normal" in2="shape" result="effect1_innerShadow_0_1" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="-3" />
          <feGaussianBlur stdDeviation="0.75" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.0244328 0 0 0 0 0.0244328 0 0 0 0 0.0244328 0 0 0 0.34 0"
          />
          <feBlend
            mode="normal"
            in2="effect1_innerShadow_0_1"
            result="effect2_innerShadow_0_1"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="0.25" />
          <feGaussianBlur stdDeviation="0.05" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.595027 0 0 0 0 0.586668 0 0 0 0 0.586668 0 0 0 1 0"
          />
          <feBlend
            mode="normal"
            in2="effect2_innerShadow_0_1"
            result="effect3_innerShadow_0_1"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="-0.25" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.596078 0 0 0 0 0.588235 0 0 0 0 0.588235 0 0 0 1 0"
          />
          <feBlend
            mode="normal"
            in2="effect3_innerShadow_0_1"
            result="effect4_innerShadow_0_1"
          />
        </filter>
      </defs>
    </svg>
  );
};

export const LogoN = () => {
  return (
    <svg
      className="w-full h-full"
      viewBox="0 0 73 73"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask id="path-1-inside-1_0_1" fill="white">
        <path d="M0 16C0 7.16344 7.16344 0 16 0H57C65.8366 0 73 7.16344 73 16V57C73 65.8366 65.8366 73 57 73H16C7.16344 73 0 65.8366 0 57V16Z" />
      </mask>
      <g filter="url(#filter0_iiii_0_1)">
        <path
          d="M0 16C0 7.16344 7.16344 0 16 0H57C65.8366 0 73 7.16344 73 16V57C73 65.8366 65.8366 73 57 73H16C7.16344 73 0 65.8366 0 57V16Z"
          fill="#181818"
        />
      </g>
      <path
        d="M0 16C0 7.10822 7.20822 -0.1 16.1 -0.1H56.9C65.7918 -0.1 73 7.10822 73 16C73 7.21867 65.8366 0.1 57 0.1H16C7.16344 0.1 0 7.21867 0 16ZM73 73H0H73ZM0 73V0V73ZM73 0V73V0Z"
        fill="#C2C2C2"
        mask="url(#path-1-inside-1_0_1)"
      />
      <g filter="url(#filter1_di_0_1)">
        <path
          d="M30.5 33.5C30.5 32.5927 31.3954 31.8571 32.5 31.8571L53.1651 31.8571C54.2697 31.8571 55.1651 32.5927 55.1651 33.5V46.6429C55.1651 47.5502 54.2697 48.2857 53.1651 48.2857H32.5C31.3954 48.2857 30.5 47.5502 30.5 46.6429V33.5Z"
          fill="url(#paint0_linear_0_1)"
          shapeRendering="crispEdges"
        />
        <path
          d="M18.1651 33.5C18.1651 32.5927 19.0606 31.8571 20.1651 31.8571H25.1651C26.2697 31.8571 27.1651 32.5927 27.1651 33.5V46.6429C27.1651 47.5502 26.2697 48.2857 25.1651 48.2857H20.1651C19.0606 48.2857 18.1651 47.5502 18.1651 46.6429V33.5Z"
          fill="url(#paint1_linear_0_1)"
          shapeRendering="crispEdges"
        />
        <path
          d="M18 25.5C18 24.5927 18.8954 23.8571 20 23.8571H53C54.1046 23.8571 55 24.5927 55 25.5V27.1429C55 28.0502 54.1046 28.7857 53 28.7857H20C18.8954 28.7857 18 28.0502 18 27.1429V25.5Z"
          fill="url(#paint2_linear_0_1)"
          shapeRendering="crispEdges"
        />
        <path
          d="M30.5 33.5C30.5 32.5927 31.3954 31.8571 32.5 31.8571L53.1651 31.8571C54.2697 31.8571 55.1651 32.5927 55.1651 33.5V46.6429C55.1651 47.5502 54.2697 48.2857 53.1651 48.2857H32.5C31.3954 48.2857 30.5 47.5502 30.5 46.6429V33.5Z"
          stroke="#6A6A6A"
          strokeOpacity="0.3"
          shapeRendering="crispEdges"
        />
        <path
          d="M18.1651 33.5C18.1651 32.5927 19.0606 31.8571 20.1651 31.8571H25.1651C26.2697 31.8571 27.1651 32.5927 27.1651 33.5V46.6429C27.1651 47.5502 26.2697 48.2857 25.1651 48.2857H20.1651C19.0606 48.2857 18.1651 47.5502 18.1651 46.6429V33.5Z"
          stroke="#6A6A6A"
          strokeOpacity="0.3"
          shapeRendering="crispEdges"
        />
        <path
          d="M18 25.5C18 24.5927 18.8954 23.8571 20 23.8571H53C54.1046 23.8571 55 24.5927 55 25.5V27.1429C55 28.0502 54.1046 28.7857 53 28.7857H20C18.8954 28.7857 18 28.0502 18 27.1429V25.5Z"
          stroke="#6A6A6A"
          strokeOpacity="0.3"
          shapeRendering="crispEdges"
        />
      </g>
      <defs>
        <filter
          id="filter0_iiii_0_1"
          x="0"
          y="-1.5"
          width="73.1"
          height="74.5"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feMorphology
            radius="1.5"
            operator="erode"
            in="SourceAlpha"
            result="effect1_innerShadow_0_1"
          />
          <feOffset />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.180889 0 0 0 0 0.180889 0 0 0 0 0.180889 0 0 0 1 0"
          />
          <feBlend mode="normal" in2="shape" result="effect1_innerShadow_0_1" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="-3" />
          <feGaussianBlur stdDeviation="0.75" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.0244328 0 0 0 0 0.0244328 0 0 0 0 0.0244328 0 0 0 0.34 0"
          />
          <feBlend
            mode="normal"
            in2="effect1_innerShadow_0_1"
            result="effect2_innerShadow_0_1"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="0.25" />
          <feGaussianBlur stdDeviation="0.05" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.595027 0 0 0 0 0.586668 0 0 0 0 0.586668 0 0 0 1 0"
          />
          <feBlend
            mode="normal"
            in2="effect2_innerShadow_0_1"
            result="effect3_innerShadow_0_1"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="-0.25" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.596078 0 0 0 0 0.588235 0 0 0 0 0.588235 0 0 0 1 0"
          />
          <feBlend
            mode="normal"
            in2="effect3_innerShadow_0_1"
            result="effect4_innerShadow_0_1"
          />
        </filter>
        <filter
          id="filter1_di_0_1"
          x="17.5"
          y="23.3571"
          width="39.6652"
          height="26.9286"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="1" dy="1" />
          <feGaussianBlur stdDeviation="0.25" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
          />
          <feBlend
            mode="normal"
            in2="BackgroundImageFix"
            result="effect1_dropShadow_0_1"
          />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="effect1_dropShadow_0_1"
            result="shape"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="1" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1 0 0 0 0 0.9963 0 0 0 0 0.9963 0 0 0 0.55 0"
          />
          <feBlend mode="normal" in2="shape" result="effect2_innerShadow_0_1" />
        </filter>
        <linearGradient
          id="paint0_linear_0_1"
          x1="16.6649"
          y1="28.5714"
          x2="50.349"
          y2="55.1992"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.185174" stopColor="#E2E2E2" />
          <stop offset="1" stopColor="#909090" />
        </linearGradient>
        <linearGradient
          id="paint1_linear_0_1"
          x1="16.6649"
          y1="28.5714"
          x2="50.349"
          y2="55.1992"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.185174" stopColor="#E2E2E2" />
          <stop offset="1" stopColor="#909090" />
        </linearGradient>
        <linearGradient
          id="paint2_linear_0_1"
          x1="16.6649"
          y1="28.5714"
          x2="50.349"
          y2="55.1992"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.185174" stopColor="#E2E2E2" />
          <stop offset="1" stopColor="#909090" />
        </linearGradient>
      </defs>
    </svg>
  );
};
