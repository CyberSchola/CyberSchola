import dynamic from "next/dynamic";

const LoginModal = dynamic(() => import("@/components/LoginModal"), {
  ssr: false,
});

const Homepage = () => {
  return (
    <>
      {/* LOGIN MODAL */}
      <LoginModal />
    </>
  );
};

export default Homepage;
