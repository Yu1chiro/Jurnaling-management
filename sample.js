const soalList = [
  {
  question: "Nihongo de nandesu ka",
  options: ["びょういん", "ゆうびんきょく", "めがねや", "とこや", "はなや"],
  answer: "a"
}
];

function isiForm(index) {
  const data = soalList[index];
  document.querySelector("#question").value = data.question;
  document.querySelector("#option_a").value = data.options[0];
  document.querySelector("#option_b").value = data.options[1];
  document.querySelector("#option_c").value = data.options[2];
  document.querySelector("#option_d").value = data.options[3];
  document.querySelector("#option_e").value = data.options[4];
  document.querySelector("#correct_answer").value = data.answer;
  
  console.log("Soal ke-" + (index+1) + " berhasil diisi!");

  // Klik tombol submit
  document.querySelector("#submitBtn").click();
}

// Loop otomatis dengan jeda antar soal (misalnya 2 detik)
soalList.forEach((_, i) => {
  setTimeout(() => {
    isiForm(i);
  }, i * 2000); // 2000ms = 2 detik antar submit
});
